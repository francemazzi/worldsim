import { randomUUID } from "node:crypto";
import { BaseAgent } from "./BaseAgent.js";
import type { AgentStoreOptions, TickContext } from "./BaseAgent.js";
import { buildPersonGraph } from "../graph/PersonGraph.js";
import { createMessageId } from "../messaging/MessageBus.js";
import type { MessageBus } from "../messaging/MessageBus.js";
import type { LLMAdapter } from "../llm/LLMAdapter.js";
import type { AgentConfig, AgentAction, AgentMessage } from "../types/AgentTypes.js";
import type { WorldContext } from "../types/WorldTypes.js";
import type { RulesContext } from "../types/RulesTypes.js";
import type { AgentTool } from "../types/PluginTypes.js";

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

  async tick(ctx: WorldContext, rules: RulesContext): Promise<AgentAction[]> {
    if (this.shouldSkipTick()) return [];

    const tickContext = await this.gatherTickContext();
    const actions: AgentAction[] = [];

    for (let i = 0; i < this.iterationsPerTick; i++) {
      if (!this.isActive) break;

      const incomingMessages = this.bus.getMessages(this.id, ctx.tickCount);
      const action = await this.singleIteration(
        ctx,
        rules,
        incomingMessages,
        i,
        tickContext,
      );
      actions.push(action);

      this.bus.publish({
        id: createMessageId(),
        from: this.id,
        to: "*",
        type: "speak",
        content: JSON.stringify(action.payload),
        tick: ctx.tickCount,
      });
    }

    await this.persistActions(actions, ctx);
    await this.updateRelationships(ctx);

    return actions;
  }

  private async gatherTickContext(): Promise<TickContext> {
    if (this.brainMemory) {
      const currentSituation = this.describeCurrentSituation();
      const [recallResult, relationships] = await Promise.all([
        this.brainMemory.recall({
          agentId: this.id,
          recentLimit: 20,
          semanticQuery: currentSituation,
          semanticTopK: 5,
          includeKnowledge: true,
        }),
        this.graphStore
          ? this.graphStore.getRelationships({ agentId: this.id, limit: 10 })
          : Promise.resolve([]),
      ]);

      return {
        memories: recallResult.memories,
        relationships,
        knowledge: recallResult.knowledge,
      };
    }

    const [memories, relationships] = await Promise.all([
      this.memoryStore
        ? this.memoryStore.getRecent(this.id, 20)
        : Promise.resolve([]),
      this.graphStore
        ? this.graphStore.getRelationships({ agentId: this.id, limit: 10 })
        : Promise.resolve([]),
    ]);
    return { memories, relationships };
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

    const allMessages = this.bus.getAllMessagesForTick(ctx.tickCount);
    const senders = new Set<string>();
    for (const msg of allMessages) {
      if (msg.from !== this.id && msg.to === "*" && msg.type === "speak") {
        senders.add(msg.from);
      }
    }

    for (const senderId of senders) {
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
        content: `Osservazioni dal tick corrente:\n${observedContent}`,
      });
    }

    messages.push({
      role: "user",
      content: `Sei al tick ${ctx.tickCount}, iterazione ${iterationIndex + 1}/${this.iterationsPerTick}. Scegli un'azione: speak (comunica qualcosa), observe (osserva il mondo), interact (interagisci con un altro agente), o finish (concludi il turno). Rispondi con JSON: {"actionType": "speak"|"observe"|"interact"|"finish", "content": "...", "stateUpdate"?: {"mood"?: string, "energy"?: number, "goals"?: string[]}}`,
    });

    const graph = buildPersonGraph({
      llm: this.llm,
      tools: this.externalTools,
      maxIterations: 3,
      worldContext: ctx,
    });

    const result = await graph.invoke({ messages });

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
        }
      }
    } catch {
      payload = lastMsg?.content ?? "";
    }

    return {
      agentId: this.id,
      actionType,
      payload,
      tick: ctx.tickCount,
    };
  }
}
