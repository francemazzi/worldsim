import { randomUUID } from "node:crypto";
import { BaseAgent } from "./BaseAgent.js";
import type { AgentStoreOptions, TickContext } from "./BaseAgent.js";
import {
  parseAgentAction,
  applyEnergyDecay,
} from "./internal/ActionParser.js";
import { MessageRouter } from "./internal/MessageRouter.js";
import { TickContextLoader } from "./internal/TickContextLoader.js";
import { buildPersonGraph } from "../graph/PersonGraph.js";
import {
  buildPerceptsPrompt,
  buildTopicContextPrompt,
  buildNeedsPrompt,
  buildAffordancesPrompt,
} from "./ProfilePromptBuilder.js";
import { AttentionPolicy } from "../perception/AttentionPolicy.js";
import type { RankedPercept } from "../perception/AttentionPolicy.js";
import type { Topic } from "../perception/TopicTracker.js";
import type { TopicTracker } from "../perception/TopicTracker.js";
import type { StimulusBus } from "../perception/StimulusBus.js";
import type { PerceptionEngine } from "../perception/PerceptionEngine.js";
import type { NeedsTracker } from "../needs/NeedsTracker.js";
import type { AffordanceResolver } from "../entities/AffordanceResolver.js";
import type { PluginRegistry } from "../plugins/PluginRegistry.js";
import type { MessageBus } from "../messaging/MessageBus.js";
import type { Message } from "../messaging/Message.js";
import type { LLMAdapter } from "../llm/LLMAdapter.js";
import type { AgentConfig, AgentAction, AgentMessage, AgentInternalState } from "../types/AgentTypes.js";
import type { WorldContext } from "../types/WorldTypes.js";
import type { RulesContext } from "../types/RulesTypes.js";
import type { AgentTool } from "../types/PluginTypes.js";
import type { RelationshipUpsert } from "../types/GraphTypes.js";
import type { TimelineMetadata } from "../types/TimelineTypes.js";

export class PersonAgent extends BaseAgent {
  private iterationsPerTick: number;
  private externalTools: AgentTool[] = [];
  private messageRouter: MessageRouter;
  private contextLoader: TickContextLoader;
  private stimulusBus?: StimulusBus | undefined;
  private perceptionEngine?: PerceptionEngine | undefined;
  private topicTracker?: TopicTracker | undefined;
  private needsTracker?: NeedsTracker | undefined;
  private affordanceResolver?: AffordanceResolver | undefined;
  private attentionPolicy?: AttentionPolicy | undefined;
  private pluginRegistry?: Pick<PluginRegistry, "runPerceptDeliveredHooks"> | undefined;
  private getWorldContext?: (() => WorldContext) | undefined;
  private recentPerceivedStimulusIds: string[] = [];

  constructor(
    config: AgentConfig,
    llm: LLMAdapter,
    bus: MessageBus,
    options?: AgentStoreOptions,
  ) {
    super(config, llm, bus, options);
    this.iterationsPerTick = config.iterationsPerTick ?? 1;

    this.messageRouter = new MessageRouter(bus, {
      conversationManager: options?.conversationManager,
      neighborhoodManager: options?.neighborhoodManager,
      graphStore: options?.graphStore,
      locationIndex: options?.locationIndex,
      defaultBroadcastRadius: options?.defaultBroadcastRadius,
      unroutableMessagePolicy: options?.unroutableMessagePolicy,
      stimulusBus: options?.stimulusBus,
      perceptionEngine: options?.perceptionEngine,
      topicTracker: options?.topicTracker,
      pluginRegistry: options?.pluginRegistry,
      getWorldContext: options?.getWorldContext,
      perceptionFallbackToLegacy: options?.perceptionFallbackToLegacy,
    });

    this.stimulusBus = options?.stimulusBus;
    this.perceptionEngine = options?.perceptionEngine;
    this.topicTracker = options?.topicTracker;
    this.needsTracker = options?.needsTracker;
    this.affordanceResolver = options?.affordanceResolver;
    this.pluginRegistry = options?.pluginRegistry;
    this.getWorldContext = options?.getWorldContext;

    if (this.perceptionEngine && this.stimulusBus) {
      this.attentionPolicy = new AttentionPolicy();
    }

    this.contextLoader = new TickContextLoader(config.id, bus, {
      memoryStore: options?.memoryStore,
      graphStore: options?.graphStore,
      assetStore: options?.assetStore,
      brainMemory: options?.brainMemory,
      conversationManager: options?.conversationManager,
      perceptionEngine: options?.perceptionEngine,
      stimulusBus: options?.stimulusBus,
      needsTracker: options?.needsTracker,
    });
  }

  setTools(pluginTools: AgentTool[]): void {
    const configTools = this.config.tools ?? [];
    const toolMap = new Map<string, AgentTool>();
    for (const t of pluginTools) toolMap.set(t.name, t);
    for (const t of configTools) toolMap.set(t.name, t);
    this.externalTools = Array.from(toolMap.values());
  }

  /**
   * Builds the full agent context for chat mode, including memories and relationships.
   */
  override async buildChatContext(
    rules: RulesContext,
  ): Promise<{ systemPrompt: string; state: AgentInternalState }> {
    const tickContext = await this.gatherTickContext();
    const systemPrompt = this.buildSystemPrompt(rules, tickContext);
    return { systemPrompt, state: { ...this.internalState } };
  }

  async tick(ctx: WorldContext, rules: RulesContext): Promise<AgentAction[]> {
    if (this.shouldSkipTick(ctx.tickCount)) return [];

    // Idle agent optimization: skip LLM call if no stimulus
    if (!this.config.alwaysThink && this.isIdle(ctx.tickCount)) {
      this.updateInternalState({ energy: Math.min(100, this.internalState.energy + 5) });
      const restAction: AgentAction = {
        agentId: this.id,
        actionType: "observe",
        payload: { status: "resting" },
        tick: ctx.tickCount,
      };
      this.stampActionTiming(restAction, [], 0);
      if (this.activityScheduler) {
        this.activityScheduler.recordAction(this.id, ctx.tickCount);
      }
      return [restAction];
    }

    // Reset per-tick token counter
    if (this.tokenBudgetTracker) {
      this.tokenBudgetTracker.resetTick(this.id, ctx.tickCount);
    }

    const tickContext = await this.gatherTickContext();
    const actions: AgentAction[] = [];

    for (let i = 0; i < this.iterationsPerTick; i++) {
      if (!this.isActive) break;

      // Check token budget before each iteration
      if (this.tokenBudgetTracker && i > 0) {
        const budgetResult = this.tokenBudgetTracker.canProceed(this.id, this.config.tokenBudget);
        if (!budgetResult.allowed) break;
      }

      // Check conversation turn-taking
      if (this.conversationManager) {
        const canSpeakResult = this.conversationManager.canSpeak(this.id);
        if (!canSpeakResult.allowed) {
          // Agent is in a conversation but it's not their turn — skip speaking
          break;
        }
      }

      const incomingMessages = this.bus.getMessages(this.id, ctx.tickCount);
      const action = await this.singleIteration(
        ctx,
        rules,
        incomingMessages,
        i,
        tickContext,
      );
      this.stampActionTiming(action, incomingMessages, i);
      actions.push(action);

      // Publish to neighbors or broadcast
      await this.publishAction(action, ctx);

      // Advance conversation turn if applicable
      if (this.conversationManager) {
        const conv = this.conversationManager.getConversationForAgent(this.id);
        if (conv) {
          this.conversationManager.advanceTurn(conv.id, this.id, ctx.tickCount);
        }
      }
    }

    // Record action in activity scheduler
    if (this.activityScheduler && actions.length > 0) {
      this.activityScheduler.recordAction(this.id, ctx.tickCount);
    }

    await this.persistActions(actions, ctx);
    await this.updateRelationships(ctx);

    // Note: decay/prune is now handled in batch by TickOrchestrator post-tick phase

    return actions;
  }

  /**
   * Publishes action to the most relevant audience via the MessageRouter
   * (conversation → neighborhood → proximity → broadcast cascade).
   */
  private async publishAction(action: AgentAction, ctx: WorldContext): Promise<void> {
    await this.messageRouter.publish(
      this.id,
      action,
      ctx.tickCount,
      this.config.neighborhood != null,
    );
  }

  private stampActionTiming(
    action: AgentAction,
    observedMessages: Message[],
    iterationIndex: number,
  ): void {
    const observedMessageIds = observedMessages.map((m) => m.id);
    const causalMetadata = observedMessageIds.length > 0 ? { observedMessageIds } : {};

    if (!this.timeline) {
      action.metadata = {
        ...(action.metadata ?? {}),
        ...causalMetadata,
      };
      return;
    }

    action.metadata = {
      ...(action.metadata ?? {}),
      ...this.timeline.reserveAction({
        agentId: this.id,
        actionType: action.actionType,
        observedMessages,
        iterationIndex,
        thinkingDelayMs: this.config.thinkingDelayMs,
      }),
      ...causalMetadata,
    };
  }

  private async gatherTickContext(): Promise<TickContext> {
    const degraded = this.isDegraded() || this.config.llmTier === "light";
    return this.contextLoader.load(degraded, this.describeCurrentSituation());
  }

  /**
   * Lightweight check: does this agent have any stimulus worth an LLM call?
   * If idle, we skip the expensive LLM call and return a "rest" action.
   */
  private isIdle(tick: number): boolean {
    return this.contextLoader.isIdle(tick, this.internalState);
  }

  private describeCurrentSituation(): string {
    const parts: string[] = [];
    parts.push(`mood: ${this.internalState.mood}`);
    parts.push(`energy: ${this.internalState.energy}`);
    if (this.internalState.goals.length > 0) {
      parts.push(`goals: ${this.internalState.goals.join(", ")}`);
    }
    return parts.join("; ");
  }

  private async persistActions(
    actions: AgentAction[],
    ctx: WorldContext,
  ): Promise<void> {
    if (actions.length === 0) return;
    if (!this.brainMemory && !this.memoryStore) return;

    const entries = actions.map((a) => ({
      id: randomUUID(),
      agentId: this.id,
      tick: ctx.tickCount,
      type: "action" as const,
      content: JSON.stringify(a.payload),
      timestamp: new Date(),
    }));

    if (this.brainMemory) {
      await this.brainMemory.saveBatch(entries, ctx.worldId);
    } else if (this.memoryStore) {
      await this.memoryStore.saveBatch(entries);
    }
  }

  private async updateRelationships(ctx: WorldContext): Promise<void> {
    if (!this.graphStore) return;

    // Use indexed getMessages (O(1)) instead of getAllMessagesForTick (O(n))
    const myMessages = this.bus.getMessages(this.id, ctx.tickCount);
    const senders = new Set<string>();
    for (const msg of myMessages) {
      // Filter: not self, not empty, only speak messages
      if (msg.from && msg.from !== this.id && msg.from !== "" && msg.type === "speak") {
        senders.add(msg.from);
      }
    }
    // Extra safeguard: never create self-referential relationships
    senders.delete(this.id);

    if (senders.size === 0) return;

    // Prefer batch upsert if available (single DB call)
    if (this.graphStore.upsertRelationshipBatch) {
      const upserts: RelationshipUpsert[] = Array.from(senders).flatMap((senderId) => [
        {
          from: this.id,
          to: senderId,
          type: "knows",
          strengthIncrement: 0.1,
          tick: ctx.tickCount,
        },
        {
          from: this.id,
          to: senderId,
          type: "trusts",
          strengthIncrement: 0.05,
          tick: ctx.tickCount,
        },
      ]);
      await this.graphStore.upsertRelationshipBatch(upserts);
      return;
    }

    // Fallback: sequential (backward-compatible)
    for (const senderId of senders) {
      // "knows" relationship
      const existing = await this.graphStore.getRelationship(
        this.id,
        senderId,
        "knows",
      );
      if (existing) {
        await this.graphStore.updateRelationship(
          this.id,
          senderId,
          "knows",
          {
            lastInteraction: ctx.tickCount,
            strength: Math.min(1, existing.strength + 0.1),
          },
        );
      } else {
        await this.graphStore.addRelationship({
          from: this.id,
          to: senderId,
          type: "knows",
          strength: 0.1,
          since: ctx.tickCount,
          lastInteraction: ctx.tickCount,
        });
      }

      // "trusts" relationship — grows slower than "knows"
      const existingTrust = await this.graphStore.getRelationship(
        this.id,
        senderId,
        "trusts",
      );
      if (existingTrust) {
        await this.graphStore.updateRelationship(
          this.id,
          senderId,
          "trusts",
          {
            lastInteraction: ctx.tickCount,
            strength: Math.min(1, existingTrust.strength + 0.05),
          },
        );
      } else {
        await this.graphStore.addRelationship({
          from: this.id,
          to: senderId,
          type: "trusts",
          strength: 0.3,
          since: ctx.tickCount,
          lastInteraction: ctx.tickCount,
        });
      }
    }
  }

  private async singleIteration(
    ctx: WorldContext,
    rules: RulesContext,
    incomingMessages: Message[],
    iterationIndex: number,
    tickContext: TickContext,
  ): Promise<AgentAction> {
    const perceptionActive =
      this.perceptionEngine != null
      && this.stimulusBus != null
      && this.attentionPolicy != null;

    const rankedPercepts = perceptionActive
      ? await this.computeAttendedPercepts(ctx.tickCount, tickContext)
      : [];

    const dominantTopic = perceptionActive
      ? this.findDominantTopic(rankedPercepts, ctx.tickCount)
      : undefined;

    const systemPrompt = this.buildSystemPromptWithPerception(
      rules,
      tickContext,
      rankedPercepts,
      dominantTopic,
    );

    const buckets = splitMessagesByChannel(incomingMessages);

    const messages: AgentMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    if (buckets.call.length > 0) {
      const lines = buckets.call.map((m) => formatCallLine(m)).join("\n");
      messages.push({
        role: "user",
        content: `Chiamata in corso — trascrizione in diretta:\n${lines}\n\nUsa 'speak_in_call' per parlare al telefono o 'hang_up' per riattaccare.`,
      });
    }

    if (buckets.sms.length > 0) {
      const lines = buckets.sms.map((m) => formatSmsLine(m)).join("\n");
      messages.push({
        role: "user",
        content: `SMS in arrivo:\n${lines}\n\nPuoi rispondere con 'send_sms' al numero del mittente, oppure ignorare.`,
      });
    }

    if (perceptionActive) {
      // In perception mode the PERCEZIONI section in the system prompt
      // already lists the salient stimuli. We ignore the legacy `voice`
      // bucket on purpose (the MessageRouter mirrored each stimulus into
      // a directed message, but the LLM should reason from percepts, not
      // from raw messages).
    } else if (buckets.voice.length > 0) {
      const observedContent = buckets.voice
        .map((m) => `[${m.from}]: ${m.content}`)
        .join("\n");
      messages.push({
        role: "user",
        content: `Le seguenti persone hanno parlato o agito nella tua zona:\n${observedContent}\n\nDevi reagire a questi messaggi. Puoi essere d'accordo, in disaccordo, ignorare chi non ti interessa, o rispondere come ritieni opportuno per il tuo personaggio.`,
      });
    }

    // Build tool section with specific tool names
    let toolSection = "";
    if (this.externalTools.length > 0) {
      const toolList = this.externalTools.slice(0, 15).map(t => `  - ${t.name}: ${t.description}`).join("\n");
      toolSection = `\nI TUOI STRUMENTI (usali attivamente, non limitarti a parlare!):\n${toolList}\nPer usarli, il sistema li chiamera automaticamente se li menzioni nel contesto.`;
    }

    // Energy-based warning
    const energy = this.internalState.energy;
    let energyWarning = "";
    if (energy < 20) {
      energyWarning = `\n⚠️ Energia CRITICA (${energy}/100). DEVI riposare: usa "finish" o "observe".`;
    } else if (energy < 40) {
      energyWarning = `\n⚠️ Energia bassa (${energy}/100). Considera "observe" o "finish" invece di azioni faticose.`;
    }

    const actionTypeUnion = perceptionActive
      ? `"speak" | "observe" | "interact" | "perceive" | "finish"`
      : `"speak" | "observe" | "interact" | "finish"`;

    const perceiveLine = perceptionActive
      ? `\n- "perceive": Se hai notato qualcosa ma non meriti reagire (rumore di sfondo, persone lontane). Resti in silenzio attivo.`
      : "";

    const silentRule = perceptionActive
      ? `\n6. Se nessun percetto merita una reazione, scegli "perceive" o "observe" invece di parlare a vuoto.`
      : "";

    const metadataSchema = perceptionActive
      ? `,
  "metadata": {
    "topicId": "id del filo se stai rispondendo a un percetto",
    "inResponseTo": "id dello stimolo a cui rispondi",
    "intensity": numero 0-1 opzionale per quanto forte/parlato e udibile sei
  }`
      : "";

    messages.push({
      role: "user",
      content: `Tick ${ctx.tickCount}, iterazione ${iterationIndex + 1}/${this.iterationsPerTick}. Energia: ${energy}/100.${energyWarning}${toolSection}

QUANDO USARE OGNI AZIONE:
- "speak": SOLO quando hai qualcosa di SPECIFICO da dire. NON usarlo come default.
- "observe": Quando vuoi capire cosa succede intorno a te. Usa PRIMA di parlare se la situazione non e chiara.
- "interact": Per azioni fisiche: lavorare nei campi, cucinare, spostarti, dare/prendere oggetti, abbracciare.
- "finish": Se sei stanco, se non hai nulla da aggiungere, o se vuoi riposare.${perceiveLine}

REGOLA VARIETA: Non fare SEMPRE "speak". Le persone reali osservano, agiscono fisicamente, riposano.
Se hai strumenti disponibili, USALI. Non descrivere a parole quello che potresti fare con un tool.

REGOLE DI RISPOSTA:
1. Rispondi SOLO con un oggetto JSON valido.
2. Il campo "stateUpdate" e OBBLIGATORIO. DEVI aggiornare il tuo stato.
3. "content" in prima persona, come parleresti/faresti davvero.
4. Se hai ricevuto messaggi, REAGISCI. Non ignorarli.
5. NON ripetere cose gia dette nei tick precedenti.${silentRule}

{
  "actionType": ${actionTypeUnion},
  "content": "quello che dici/fai/osservi",
  "target": "nome agente a cui ti rivolgi (opzionale)",
  "stateUpdate": {
    "mood": "umore attuale (OBBLIGATORIO)",
    "energy": numero 0-100 (OBBLIGATORIO, diminuisce con attivita),
    "goals": ["obiettivi aggiornati"]
  }${metadataSchema}
}`,
    });

    const agentCtx: WorldContext = {
      ...ctx,
      metadata: { ...ctx.metadata, currentAgentId: this.id },
    };

    const graph = buildPersonGraph({
      llm: this.llm,
      tools: this.externalTools,
      maxIterations: 3,
      worldContext: agentCtx,
    });

    const result = await graph.invoke({ messages });

    // Detect if tools were executed during the graph run
    const hasToolCalls = result.toolResults && result.toolResults.length > 0;

    const lastMsg = result.messages[result.messages.length - 1];
    const parsed = parseAgentAction(lastMsg?.content);
    let { actionType, payload } = parsed;
    const metadata = this.buildActionMetadata(parsed.metadata, rankedPercepts);

    if (parsed.stateUpdate) {
      this.updateInternalState(parsed.stateUpdate);
    } else {
      this.updateInternalState({
        energy: applyEnergyDecay(this.internalState.energy, actionType),
      });
    }

    // If tools were executed, override actionType and enrich payload
    if (hasToolCalls) {
      actionType = "tool_call";
      payload = {
        toolResults: result.toolResults,
        summary:
          typeof payload === "string"
            ? payload
            : (payload as Record<string, unknown>)?.content
              ?? lastMsg?.content
              ?? "",
      };
    }

    return {
      agentId: this.id,
      actionType,
      payload,
      tick: ctx.tickCount,
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
  }

  /**
   * Runs the perception pipeline (PerceptionEngine + AttentionPolicy) for
   * the current tick and returns the percepts the agent actually attends
   * to. Updates the rolling novelty window so percepts seen this tick are
   * marked as "non-novel" on the next call.
   */
  private async computeAttendedPercepts(
    tick: number,
    tickContext: TickContext,
  ): Promise<RankedPercept[]> {
    if (!this.perceptionEngine || !this.stimulusBus || !this.attentionPolicy) {
      return [];
    }

    let raw = this.perceiveRetained(tick);
    const worldCtx = this.getWorldContext?.();
    if (this.pluginRegistry && worldCtx) {
      raw = await this.pluginRegistry.runPerceptDeliveredHooks(
        this.id,
        raw,
        worldCtx,
      );
    }
    if (raw.length === 0) return [];

    const ranked = this.attentionPolicy.process(raw, {
      agentId: this.id,
      agentState: this.internalState,
      ...(this.needsTracker?.get(this.id)
        ? { needs: this.needsTracker.get(this.id)! }
        : {}),
      relationships: tickContext.relationships,
      recentPerceptStimulusIds: this.recentPerceivedStimulusIds,
      currentTick: tick,
      ...(this.config.attention ? { config: this.config.attention } : {}),
    });

    const seen = ranked.map((r) => r.percept.stimulus.id);
    if (seen.length > 0) {
      this.recentPerceivedStimulusIds = [
        ...this.recentPerceivedStimulusIds,
        ...seen,
      ].slice(-50);
    }

    return ranked;
  }

  private perceiveRetained(tick: number): import("../types/PerceptionTypes.js").Percept[] {
    if (!this.perceptionEngine || !this.stimulusBus) return [];
    const retainedTicks = this.stimulusBus
      .getRetainedTicks()
      .filter((retainedTick) => retainedTick <= tick);
    const out: import("../types/PerceptionTypes.js").Percept[] = [];
    for (const retainedTick of retainedTicks) {
      out.push(...this.perceptionEngine.perceiveFor(
        this.id,
        this.stimulusBus,
        retainedTick,
      ));
    }
    return out;
  }

  /**
   * Picks the open topic the agent is most engaged with. Heuristic: the
   * topic that appears most often in the agent's current attended percepts
   * (and that the agent itself is a participant of, when possible).
   */
  private findDominantTopic(
    rankedPercepts: RankedPercept[],
    tick: number,
  ): Topic | undefined {
    if (!this.topicTracker || rankedPercepts.length === 0) return undefined;
    const counts = new Map<string, number>();
    for (const r of rankedPercepts) {
      const tid = r.percept.stimulus.topicId;
      if (!tid) continue;
      counts.set(tid, (counts.get(tid) ?? 0) + 1);
    }
    if (counts.size === 0) {
      // Fall back to the most recent open topic the agent has spoken in.
      return this.topicTracker.openTopicsForAgent(this.id, tick);
    }
    let bestId: string | undefined;
    let bestCount = 0;
    for (const [tid, count] of counts) {
      if (count > bestCount) {
        bestId = tid;
        bestCount = count;
      }
    }
    if (!bestId) return undefined;
    return this.topicTracker.getTopic(bestId);
  }

  /**
   * Wraps `BaseAgent.buildSystemPrompt` and appends perception-related
   * sections (PERCEZIONI, FILO DISCORSIVO, BISOGNI ATTIVI) when the
   * realistic-simulation layer is wired in. In legacy mode this is a
   * no-op pass-through and the prompt is bit-for-bit identical to before.
   */
  private buildSystemPromptWithPerception(
    rules: RulesContext,
    tickContext: TickContext,
    rankedPercepts: RankedPercept[],
    dominantTopic: Topic | undefined,
  ): string {
    const base = this.buildSystemPrompt(rules, tickContext);
    const extra: string[] = [];

    if (rankedPercepts.length > 0) {
      const topicById = this.topicTracker
        ? new Map<string, Topic>()
        : undefined;
      if (this.topicTracker && topicById) {
        for (const r of rankedPercepts) {
          const tid = r.percept.stimulus.topicId;
          if (!tid || topicById.has(tid)) continue;
          const topic = this.topicTracker.getTopic(tid);
          if (topic) topicById.set(tid, topic);
        }
      }
      const perceptsSection = buildPerceptsPrompt(rankedPercepts, topicById);
      if (perceptsSection) extra.push(perceptsSection);
    }

    if (dominantTopic) {
      extra.push(buildTopicContextPrompt(dominantTopic, this.id));
    }

    if (this.affordanceResolver && rankedPercepts.length > 0) {
      const affordances = this.affordanceResolver.fromPercepts(
        rankedPercepts.map((r) => r.percept),
      );
      const affordancesSection = buildAffordancesPrompt(affordances);
      if (affordancesSection) extra.push(affordancesSection);
    }

    if (this.needsTracker) {
      const needs = this.needsTracker.get(this.id);
      const needsSection = buildNeedsPrompt(needs);
      if (needsSection) extra.push(needsSection);
    }

    if (extra.length === 0) return base;
    return `${base}\n\n${extra.join("\n\n")}`;
  }

  private buildActionMetadata(
    parsedMetadata: TimelineMetadata | undefined,
    rankedPercepts: RankedPercept[],
  ): TimelineMetadata {
    const metadata: TimelineMetadata = { ...(parsedMetadata ?? {}) };
    const topStimulus = rankedPercepts[0]?.percept.stimulus;
    if (topStimulus) {
      if (metadata.topicId == null && topStimulus.topicId) {
        metadata.topicId = topStimulus.topicId;
      }
      if (metadata.inResponseTo == null) {
        metadata.inResponseTo = topStimulus.id;
      }
    }
    return metadata;
  }
}

interface MessageBuckets {
  sms: Message[];
  call: Message[];
  voice: Message[];
}

/**
 * Splits a list of incoming messages into three buckets so the prompt can
 * present each channel separately.
 *
 * - `call`: messages from the current phone call (type === "call_transcript")
 * - `sms`: text messages (type === "sms")
 * - `voice`: everything else (speak/observe/warn/system)
 */
function splitMessagesByChannel(messages: Message[]): MessageBuckets {
  const buckets: MessageBuckets = { sms: [], call: [], voice: [] };
  for (const msg of messages) {
    if (msg.type === "call_transcript") buckets.call.push(msg);
    else if (msg.type === "sms") buckets.sms.push(msg);
    else buckets.voice.push(msg);
  }
  return buckets;
}

function formatSmsLine(msg: Message): string {
  const number = msg.metadata?.fromNumber;
  const label = number ? `${number} (${msg.from})` : msg.from;
  return `[${label}]: ${msg.content}`;
}

function formatCallLine(msg: Message): string {
  const isSystem = msg.metadata?.system === true;
  if (isSystem) return msg.content;
  const number = msg.metadata?.fromNumber;
  const label = number ? `${number} (${msg.from})` : msg.from;
  return `[${label}]: ${msg.content}`;
}
