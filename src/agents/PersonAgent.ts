import { randomUUID } from "node:crypto";
import { BaseAgent } from "./BaseAgent.js";
import type { AgentStoreOptions, TickContext } from "./BaseAgent.js";
import { buildPersonGraph } from "../graph/PersonGraph.js";
import { createMessageId } from "../messaging/MessageBus.js";
import type { MessageBus } from "../messaging/MessageBus.js";
import type { LLMAdapter } from "../llm/LLMAdapter.js";
import type { AgentConfig, AgentAction, AgentMessage, AgentInternalState } from "../types/AgentTypes.js";
import type { WorldContext } from "../types/WorldTypes.js";
import type { RulesContext } from "../types/RulesTypes.js";
import type { AgentTool } from "../types/PluginTypes.js";
import type { RelationshipUpsert } from "../types/GraphTypes.js";

export class PersonAgent extends BaseAgent {
  private iterationsPerTick: number;
  private externalTools: AgentTool[] = [];

  constructor(
    config: AgentConfig,
    llm: LLMAdapter,
    bus: MessageBus,
    options?: AgentStoreOptions,
  ) {
    super(config, llm, bus, options);
    this.iterationsPerTick = config.iterationsPerTick ?? 1;
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
   * Publishes action to neighbors (if neighborhood configured) or broadcasts to all.
   */
  private async publishAction(action: AgentAction, ctx: WorldContext): Promise<void> {
    const msg = {
      id: createMessageId(),
      from: this.id,
      type: "speak" as const,
      content: JSON.stringify(action.payload),
      tick: ctx.tickCount,
    };

    // If in a conversation, send only to conversation participants
    if (this.conversationManager) {
      const conv = this.conversationManager.getConversationForAgent(this.id);
      if (conv) {
        const recipients = conv.participantIds.filter((id) => id !== this.id);
        this.bus.publishToGroup(msg, recipients);
        return;
      }
    }

    // If neighborhood is configured, send only to neighbors
    if (this.neighborhoodManager && this.graphStore && this.config.neighborhood) {
      const neighbors = await this.neighborhoodManager.getActiveNeighbors(this.id, this.graphStore);
      if (neighbors.length > 0) {
        this.bus.publishToGroup(msg, neighbors);
        return;
      }
    }

    // Proximity-based fallback: send to nearby agents instead of broadcasting
    if (this.locationIndex && this.defaultBroadcastRadius && this.defaultBroadcastRadius > 0) {
      const nearby = this.locationIndex.findNearby(this.id, this.defaultBroadcastRadius);
      if (nearby.length > 0) {
        this.bus.publishToGroup(msg, nearby.map((n) => n.agentId));
        return;
      }
    }

    // Last resort: broadcast to all (backward-compatible when no location/radius configured)
    console.warn(
      `[PersonAgent] Agent "${this.id}" falling back to broadcast at tick ${ctx.tickCount}. ` +
      `Consider configuring neighborhood, location, or broadcastRadius.`,
    );
    this.bus.publish({ ...msg, to: "*" });
  }

  private async gatherTickContext(): Promise<TickContext> {
    const degraded = this.isDegraded() || this.config.llmTier === "light";
    const memoryLimit = degraded ? 5 : 20;
    const relLimit = degraded ? 3 : 10;

    if (this.brainMemory) {
      const currentSituation = this.describeCurrentSituation();
      const [recallResult, relationships] = await Promise.all([
        this.brainMemory.recall({
          agentId: this.id,
          recentLimit: memoryLimit,
          semanticQuery: currentSituation,
          semanticTopK: degraded ? 0 : 5,
          includeKnowledge: !degraded,
        }),
        this.graphStore
          ? this.graphStore.getRelationships({ agentId: this.id, limit: relLimit })
          : Promise.resolve([]),
      ]);

      const tickCtx: TickContext = {
        memories: recallResult.memories,
        relationships,
        knowledge: degraded ? undefined : recallResult.knowledge,
      };

      // Load assets if available
      if (this.assetStore) {
        const [agentAssets, household, currentVenue, householdAssets, communityAssets] = await Promise.all([
          this.assetStore.getAgentAssets(this.id),
          this.assetStore.getAgentHousehold(this.id),
          this.assetStore.getAgentCurrentVenue(this.id),
          this.assetStore.getAgentHousehold(this.id).then(
            (h) => h ? this.assetStore!.getHouseholdAssets(h.id) : [],
          ),
          this.assetStore.getCommunityAssets(),
        ]);
        tickCtx.assets = [...agentAssets, ...householdAssets, ...communityAssets];
        tickCtx.household = household ?? undefined;
        tickCtx.currentVenue = currentVenue ?? undefined;
      }

      return tickCtx;
    }

    const [memories, relationships] = await Promise.all([
      this.memoryStore
        ? this.memoryStore.getRecent(this.id, memoryLimit)
        : Promise.resolve([]),
      this.graphStore
        ? this.graphStore.getRelationships({ agentId: this.id, limit: relLimit })
        : Promise.resolve([]),
    ]);

    // Load assets if available
    if (this.assetStore) {
      const [agentAssets, household, currentVenue, householdAssets, communityAssets] = await Promise.all([
        this.assetStore.getAgentAssets(this.id),
        this.assetStore.getAgentHousehold(this.id),
        this.assetStore.getAgentCurrentVenue(this.id),
        this.assetStore.getAgentHousehold(this.id).then(
          (h) => h ? this.assetStore!.getHouseholdAssets(h.id) : [],
        ),
        this.assetStore.getCommunityAssets(),
      ]);
      return {
        memories,
        relationships,
        assets: [...agentAssets, ...householdAssets, ...communityAssets],
        household: household ?? undefined,
        currentVenue: currentVenue ?? undefined,
      };
    }

    return { memories, relationships };
  }

  /**
   * Lightweight check: does this agent have any stimulus worth an LLM call?
   * If idle, we skip the expensive LLM call and return a "rest" action.
   */
  private isIdle(tick: number): boolean {
    // Has incoming messages? (O(1) with recipient index)
    if (this.bus.getMessageCount(this.id, tick) > 0) return false;

    // Has active goals?
    if (this.internalState.goals.length > 0) return false;

    // Has enough energy to be active?
    if (this.internalState.energy > 30) return false;

    // Is in an active conversation?
    if (this.conversationManager) {
      const conv = this.conversationManager.getConversationForAgent(this.id);
      if (conv) return false;
    }

    return true;
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
    incomingMessages: { content: string; from: string }[],
    iterationIndex: number,
    tickContext: TickContext,
  ): Promise<AgentAction> {
    const systemPrompt = this.buildSystemPrompt(rules, tickContext);

    const observedContent = incomingMessages
      .map((m) => `[${m.from}]: ${m.content}`)
      .join("\n");

    const messages: AgentMessage[] = [
      { role: "system", content: systemPrompt },
    ];

    if (observedContent) {
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

    messages.push({
      role: "user",
      content: `Tick ${ctx.tickCount}, iterazione ${iterationIndex + 1}/${this.iterationsPerTick}. Energia: ${energy}/100.${energyWarning}${toolSection}

QUANDO USARE OGNI AZIONE:
- "speak": SOLO quando hai qualcosa di SPECIFICO da dire. NON usarlo come default.
- "observe": Quando vuoi capire cosa succede intorno a te. Usa PRIMA di parlare se la situazione non e chiara.
- "interact": Per azioni fisiche: lavorare nei campi, cucinare, spostarti, dare/prendere oggetti, abbracciare.
- "finish": Se sei stanco, se non hai nulla da aggiungere, o se vuoi riposare.

REGOLA VARIETA: Non fare SEMPRE "speak". Le persone reali osservano, agiscono fisicamente, riposano.
Se hai strumenti disponibili, USALI. Non descrivere a parole quello che potresti fare con un tool.

REGOLE DI RISPOSTA:
1. Rispondi SOLO con un oggetto JSON valido.
2. Il campo "stateUpdate" e OBBLIGATORIO. DEVI aggiornare il tuo stato.
3. "content" in prima persona, come parleresti/faresti davvero.
4. Se hai ricevuto messaggi, REAGISCI. Non ignorarli.
5. NON ripetere cose gia dette nei tick precedenti.

{
  "actionType": "speak" | "observe" | "interact" | "finish",
  "content": "quello che dici/fai/osservi",
  "target": "nome agente a cui ti rivolgi (opzionale)",
  "stateUpdate": {
    "mood": "umore attuale (OBBLIGATORIO)",
    "energy": numero 0-100 (OBBLIGATORIO, diminuisce con attivita),
    "goals": ["obiettivi aggiornati"]
  }
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
    let actionType: AgentAction["actionType"] = "speak";
    let payload: unknown = lastMsg?.content ?? "";

    try {
      const jsonMatch = lastMsg?.content?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          actionType?: string;
          content?: string;
          stateUpdate?: {
            mood?: string;
            energy?: number;
            goals?: string[];
          };
        };
        if (
          parsed.actionType &&
          ["speak", "observe", "interact", "tool_call", "finish"].includes(
            parsed.actionType,
          )
        ) {
          actionType = parsed.actionType as AgentAction["actionType"];
        }
        payload = parsed.content ?? parsed;

        if (parsed.stateUpdate) {
          this.updateInternalState(parsed.stateUpdate);
        } else {
          // Default energy decay: every action costs energy
          const energyCost = actionType === "observe" ? 2 : actionType === "finish" ? 0 : 5;
          if (energyCost > 0) {
            this.updateInternalState({
              energy: Math.max(0, this.internalState.energy - energyCost),
            });
          }
        }
      }
    } catch {
      payload = lastMsg?.content ?? "";
      // Even on parse failure, decay energy
      this.updateInternalState({
        energy: Math.max(0, this.internalState.energy - 5),
      });
    }

    // If tools were executed, override actionType and enrich payload
    if (hasToolCalls) {
      actionType = "tool_call";
      payload = {
        toolResults: result.toolResults,
        summary: typeof payload === "string" ? payload : (payload as Record<string, unknown>)?.content ?? lastMsg?.content ?? "",
      };
    }

    return {
      agentId: this.id,
      actionType,
      payload,
      tick: ctx.tickCount,
    };
  }
}
