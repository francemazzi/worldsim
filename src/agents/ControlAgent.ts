import { BaseAgent } from "./BaseAgent.js";
import { buildControlGraph } from "../graph/ControlGraph.js";
import { createMessageId } from "../messaging/MessageBus.js";
import type { MessageBus } from "../messaging/MessageBus.js";
import type { LLMAdapter } from "../llm/LLMAdapter.js";
import type {
  AgentConfig,
  AgentAction,
  AgentControlEvent,
} from "../types/AgentTypes.js";
import type { WorldContext } from "../types/WorldTypes.js";
import type { RulesContext } from "../types/RulesTypes.js";
import type { AgentTool } from "../types/PluginTypes.js";

export interface EvaluationResult {
  agentId: string;
  actionType: string;
  verdict: "approved" | "blocked" | "warned";
  reason?: string;
  suggestion?: string;
}

export class ControlAgent extends BaseAgent {
  private watchPatterns: string[] = [];

  constructor(config: AgentConfig, llm: LLMAdapter, bus: MessageBus) {
    super(config, llm, bus);
  }

  private buildControlAgentTool(): AgentTool {
    const bus = this.bus;
    const agentId = this.config.id;

    return {
      name: "control_agent",
      description: `Controlla il ciclo di vita di un PersonAgent. Usa questo tool quando un agente viola regole 'hard' e deve essere fermato, oppure quando un agente sospeso deve essere riattivato. Azioni: 'pause' (temporaneo), 'resume' (riattiva), 'stop' (definitivo). NON usare 'stop' a meno che la violazione sia critica e irreversibile. NON usare su agenti con role='control'.`,
      inputSchema: {
        type: "object",
        properties: {
          targetAgentId: { type: "string" },
          action: { type: "string", enum: ["pause", "resume", "stop"] },
          reason: { type: "string" },
        },
        required: ["targetAgentId", "action", "reason"],
      },
      async execute(input: unknown, ctx: WorldContext): Promise<unknown> {
        const { targetAgentId, action, reason } = input as {
          targetAgentId: string;
          action: "pause" | "resume" | "stop";
          reason: string;
        };

        const event: AgentControlEvent = {
          type: `agent:${action}`,
          agentId: targetAgentId,
          requestedBy: agentId,
          tick: ctx.tickCount,
          reason,
        };

        bus.publish({
          id: createMessageId(),
          from: agentId,
          to: "world-engine",
          type: "system",
          content: JSON.stringify(event),
          tick: ctx.tickCount,
        });

        return {
          success: true,
          message: `${action} richiesto per ${targetAgentId}: ${reason}`,
        };
      },
    };
  }

  async bootstrap(rules: RulesContext): Promise<void> {
    if (this.shouldSkipTick()) return;

    const systemPrompt = this.buildSystemPrompt(rules);
    const response = await this.llm.chat([
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content:
          "Date queste regole, quali sono i pattern critici che devo monitorare durante la simulazione? Restituisci una lista JSON di pattern da osservare.",
      },
    ]);

    try {
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        this.watchPatterns = JSON.parse(jsonMatch[0]) as string[];
      }
    } catch {
      this.watchPatterns = [response.content];
    }
  }

  async tick(ctx: WorldContext, rules: RulesContext): Promise<AgentAction[]> {
    if (this.shouldSkipTick()) return [];

    return [
      {
        agentId: this.id,
        actionType: "observe",
        payload: { watchPatterns: this.watchPatterns },
        tick: ctx.tickCount,
      },
    ];
  }

  async evaluateActions(
    actions: AgentAction[],
    ctx: WorldContext,
    rules: RulesContext,
  ): Promise<EvaluationResult[]> {
    if (this.shouldSkipTick() || actions.length === 0) return [];

    const hardRules = rules
      .getRulesForScope("all")
      .filter((r) => r.enforcement === "hard");

    const personHardRules = rules
      .getRulesForScope("person")
      .filter((r) => r.enforcement === "hard");

    const allHardRules = [...hardRules, ...personHardRules];
    if (allHardRules.length === 0 && this.watchPatterns.length === 0) {
      return actions.map((a) => ({
        agentId: a.agentId,
        actionType: a.actionType,
        verdict: "approved" as const,
      }));
    }

    const rulesStr = allHardRules
      .map((r) => `[${r.id}] ${r.instruction}`)
      .join("\n");

    const actionsStr = actions
      .map(
        (a) =>
          `Agent ${a.agentId} (${a.actionType}): ${JSON.stringify(a.payload)}`,
      )
      .join("\n");

    const tools = [this.buildControlAgentTool()];
    const graph = buildControlGraph({
      llm: this.llm,
      tools,
      worldContext: ctx,
    });

    const result = await graph.invoke({
      messages: [
        {
          role: "system" as const,
          content: `Sei un agente di governance. Valuta le seguenti azioni rispetto alle regole.
Per ogni azione, rispondi con un JSON array: [{"agentId": string, "actionType": string, "verdict": "approved"|"blocked"|"warned", "reason"?: string, "suggestion"?: string}].
Se un agente viola regole hard, usa il tool control_agent per fermarlo.

REGOLE HARD:
${rulesStr}

PATTERN MONITORATI:
${this.watchPatterns.join("\n")}`,
        },
        {
          role: "user" as const,
          content: `Valuta queste azioni del tick ${ctx.tickCount}:\n${actionsStr}`,
        },
      ],
    });

    const lastMsg = result.messages[result.messages.length - 1];
    if (!lastMsg) {
      return actions.map((a) => ({
        agentId: a.agentId,
        actionType: a.actionType,
        verdict: "approved" as const,
      }));
    }

    try {
      const jsonMatch = lastMsg.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as EvaluationResult[];
      }
    } catch {
      // Fall through to default
    }

    return actions.map((a) => ({
      agentId: a.agentId,
      actionType: a.actionType,
      verdict: "approved" as const,
    }));
  }
}
