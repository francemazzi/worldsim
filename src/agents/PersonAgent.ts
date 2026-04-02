import { BaseAgent } from "./BaseAgent.js";
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

  constructor(config: AgentConfig, llm: LLMAdapter, bus: MessageBus) {
    super(config, llm, bus);
    this.iterationsPerTick = config.iterationsPerTick ?? 1;
  }

  setTools(tools: AgentTool[]): void {
    this.externalTools = tools;
  }

  async tick(ctx: WorldContext, rules: RulesContext): Promise<AgentAction[]> {
    if (this.shouldSkipTick()) return [];

    const actions: AgentAction[] = [];

    for (let i = 0; i < this.iterationsPerTick; i++) {
      if (!this.isActive) break;

      const incomingMessages = this.bus.getMessages(this.id, ctx.tickCount);
      const action = await this.singleIteration(ctx, rules, incomingMessages, i);
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

    return actions;
  }

  private async singleIteration(
    ctx: WorldContext,
    rules: RulesContext,
    incomingMessages: { content: string; from: string }[],
    iterationIndex: number,
  ): Promise<AgentAction> {
    const systemPrompt = this.buildSystemPrompt(rules);

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
      content: `Sei al tick ${ctx.tickCount}, iterazione ${iterationIndex + 1}/${this.iterationsPerTick}. Scegli un'azione: speak (comunica qualcosa), observe (osserva il mondo), interact (interagisci con un altro agente), o finish (concludi il turno). Rispondi con JSON: {"actionType": "speak"|"observe"|"interact"|"finish", "content": "..."}`,
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
