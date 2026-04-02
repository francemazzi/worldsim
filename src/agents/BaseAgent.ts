import { AgentLifecycle } from "./AgentLifecycle.js";
import type { MessageBus } from "../messaging/MessageBus.js";
import { createMessageId } from "../messaging/MessageBus.js";
import type { LLMAdapter } from "../llm/LLMAdapter.js";
import type {
  AgentConfig,
  AgentAction,
  AgentStatus,
  AgentControlEvent,
  AgentMessage,
} from "../types/AgentTypes.js";
import type { WorldContext, WorldEvent } from "../types/WorldTypes.js";
import type { RulesContext, Rule } from "../types/RulesTypes.js";
import type { Message } from "../messaging/Message.js";

export abstract class BaseAgent {
  protected config: AgentConfig;
  protected llm: LLMAdapter;
  protected bus: MessageBus;
  private lifecycle: AgentLifecycle = new AgentLifecycle();

  constructor(config: AgentConfig, llm: LLMAdapter, bus: MessageBus) {
    this.config = config;
    this.llm = llm;
    this.bus = bus;
  }

  get id(): string {
    return this.config.id;
  }

  get role(): AgentConfig["role"] {
    return this.config.role;
  }

  get status(): AgentStatus {
    return this.lifecycle.current;
  }

  get isActive(): boolean {
    return this.lifecycle.isActive;
  }

  start(tick = 0): void {
    const oldStatus = this.lifecycle.current;
    if (this.lifecycle.transition("start")) {
      this.emitLifecycleEvent("agent:start", "world-engine", tick);
    }
  }

  pause(tick = 0, requestedBy = "host"): void {
    if (this.lifecycle.transition("pause")) {
      this.emitLifecycleEvent("agent:pause", requestedBy, tick);
    }
  }

  resume(tick = 0, requestedBy = "host"): void {
    if (this.lifecycle.transition("resume")) {
      this.emitLifecycleEvent("agent:resume", requestedBy, tick);
    }
  }

  stop(tick = 0, requestedBy = "host"): void {
    if (this.lifecycle.transition("stop")) {
      this.emitLifecycleEvent("agent:stop", requestedBy, tick);
    }
  }

  protected shouldSkipTick(): boolean {
    return !this.lifecycle.isActive;
  }

  abstract tick(ctx: WorldContext, rules: RulesContext): Promise<AgentAction[]>;

  protected buildSystemPrompt(rules: RulesContext): string {
    const scopeRules = rules.getRulesForScope(
      this.config.role === "control" ? "control" : "person",
    );
    const allRules = rules.getRulesForScope("all");

    const uniqueRules = new Map<string, Rule>();
    for (const r of [...allRules, ...scopeRules]) {
      uniqueRules.set(r.id, r);
    }

    const rulesText = Array.from(uniqueRules.values())
      .sort((a, b) => a.priority - b.priority)
      .map((r) => `[${r.enforcement.toUpperCase()}] ${r.instruction}`)
      .join("\n");

    return `${this.config.systemPrompt}\n\n--- RULES ---\n${rulesText}`;
  }

  protected emit(event: WorldEvent): void {
    this.bus.broadcast({
      id: createMessageId(),
      from: this.config.id,
      type: "observe",
      content: JSON.stringify(event),
      tick: event.tick,
    });
  }

  protected onMessage(handler: (msg: Message) => void): () => void {
    return this.bus.subscribe(this.config.id, handler);
  }

  private emitLifecycleEvent(
    type: AgentControlEvent["type"],
    requestedBy: string,
    tick: number,
    reason?: string,
  ): void {
    const event: AgentControlEvent = {
      type,
      agentId: this.config.id,
      requestedBy,
      tick,
      reason,
    };
    this.bus.publish({
      id: createMessageId(),
      from: this.config.id,
      to: "world-engine",
      type: "system",
      content: JSON.stringify(event),
      tick,
    });
  }
}
