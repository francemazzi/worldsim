import type { AgentAction } from "../../types/AgentTypes.js";
import type { WorldEngineRuntime } from "./WorldEngineRuntime.js";
import { ControlEventApplier } from "./ControlEventApplier.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TickOrchestrator {
  constructor(
    private runtime: WorldEngineRuntime,
    private controlEventApplier: ControlEventApplier,
    private logEvent: (type: string, agentId: string, payload: unknown) => void,
  ) {}

  async runLoop(): Promise<void> {
    const maxTicks = this.runtime.config.maxTicks ?? Infinity;
    const interval = this.runtime.config.tickIntervalMs ?? 0;

    while (
      this.runtime.status === "running"
      && this.runtime.clock.current() < maxTicks
    ) {
      await this.executeTick();
      if (interval > 0) await sleep(interval);
    }

    if (this.runtime.status === "running") {
      this.runtime.status = "stopped";
      await this.runtime.pluginRegistry.runHook(
        "onWorldStop",
        this.runtime.context,
        this.runtime.eventLog,
      );
    }
  }

  async executeTick(): Promise<void> {
    const tick = this.runtime.clock.increment();
    this.runtime.messageBus.newTick(tick);
    this.runtime.context.tickCount = tick;

    await this.runtime.pluginRegistry.runHook(
      "onWorldTick",
      tick,
      this.runtime.context,
    );

    for (const handler of this.runtime.tickHandlers) {
      try {
        handler(tick);
      } catch {
        // ignore tick handler errors
      }
    }

    // Reset per-tick token counters
    this.runtime.tokenBudgetTracker.resetAllTicks(tick);

    // Cleanup stale conversations
    this.runtime.conversationManager.tickCleanup(tick);

    // Filter active agents and sort by priority (agents with pending messages first)
    const activePersonAgents = this.runtime.personAgents
      .filter((a) => a.isActive)
      .sort((a, b) => {
        const aMsgs = this.runtime.messageBus.getMessageCount(a.id, tick);
        const bMsgs = this.runtime.messageBus.getMessageCount(b.id, tick);
        return bMsgs - aMsgs; // More messages = higher priority
      });

    const allActions: AgentAction[] = [];

    // Execute agents through batch executor with concurrency limit
    const tasks = activePersonAgents.map((agent) => {
      return async () => {
        const actions = await agent.tick(
          this.runtime.context,
          this.runtime.rulesContext!,
        );
        return actions;
      };
    });

    const results = await this.runtime.batchExecutor.execute(tasks);
    for (const actions of results) {
      allActions.push(...actions);
    }

    this.controlEventApplier.apply(tick);

    if (this.runtime.controlAgents.length > 0 && allActions.length > 0) {
      for (const ca of this.runtime.controlAgents) {
        if (!ca.isActive) continue;
        const evaluations = await ca.evaluateActions(
          allActions,
          this.runtime.context,
          this.runtime.rulesContext!,
        );

        for (const evaluation of evaluations) {
          if (evaluation.verdict === "blocked") {
            this.logEvent("action:blocked", evaluation.agentId, {
              reason: evaluation.reason,
            });
          } else if (evaluation.verdict === "warned") {
            this.logEvent("action:warned", evaluation.agentId, {
              suggestion: evaluation.suggestion,
            });
          } else {
            this.logEvent("action:executed", evaluation.agentId, {});
          }
        }
      }
    } else {
      for (const action of allActions) {
        this.logEvent("action:executed", action.agentId, {
          actionType: action.actionType,
        });
      }
    }

    for (const action of allActions) {
      await this.runtime.pluginRegistry.runHookWithTransform(
        "onAgentAction",
        action,
        {
          agentId: action.agentId,
          status: "running",
          currentMessages: [],
          loopCount: 0,
          ephemeralMemory: {},
        },
      );
    }

    for (const ca of this.runtime.controlAgents) {
      if (ca.isActive) {
        await ca.tick(this.runtime.context, this.runtime.rulesContext!);
      }
    }
  }
}
