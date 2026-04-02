import type { TokenBudget, TokenUsage } from "../types/ScheduleTypes.js";

export interface TokenBudgetResult {
  allowed: boolean;
  policy: "pause" | "degrade" | "stop";
  reason?: string | undefined;
}

export class TokenBudgetTracker {
  private usage: Map<string, TokenUsage> = new Map();

  /**
   * Records token consumption for an agent.
   */
  record(
    agentId: string,
    tokens: { inputTokens: number; outputTokens: number },
  ): void {
    const total = tokens.inputTokens + tokens.outputTokens;
    const existing = this.usage.get(agentId);

    if (!existing) {
      this.usage.set(agentId, {
        tickTokens: total,
        hourTokens: total,
        lifetimeTokens: total,
        lastResetTick: 0,
        lastHourResetTick: 0,
      });
      return;
    }

    existing.tickTokens += total;
    existing.hourTokens += total;
    existing.lifetimeTokens += total;
  }

  /**
   * Checks whether an agent can proceed given its token budget.
   */
  canProceed(agentId: string, budget: TokenBudget | undefined): TokenBudgetResult {
    if (!budget) {
      return { allowed: true, policy: "pause" };
    }

    const policy = budget.policy ?? "pause";
    const usage = this.usage.get(agentId);

    if (!usage) {
      return { allowed: true, policy };
    }

    if (budget.perTick != null && usage.tickTokens >= budget.perTick) {
      return { allowed: false, policy, reason: `Tick budget exceeded: ${usage.tickTokens}/${budget.perTick}` };
    }

    if (budget.perHour != null && usage.hourTokens >= budget.perHour) {
      return { allowed: false, policy, reason: `Hour budget exceeded: ${usage.hourTokens}/${budget.perHour}` };
    }

    if (budget.lifetime != null && usage.lifetimeTokens >= budget.lifetime) {
      return { allowed: false, policy, reason: `Lifetime budget exceeded: ${usage.lifetimeTokens}/${budget.lifetime}` };
    }

    return { allowed: true, policy };
  }

  /**
   * Resets per-tick token counter. Called at the start of each tick.
   */
  resetTick(agentId: string, currentTick: number): void {
    const usage = this.usage.get(agentId);
    if (usage) {
      usage.tickTokens = 0;
      usage.lastResetTick = currentTick;
    }
  }

  /**
   * Resets per-hour token counter. Called when simulated hour rolls over.
   */
  resetHour(agentId: string, currentTick: number): void {
    const usage = this.usage.get(agentId);
    if (usage) {
      usage.hourTokens = 0;
      usage.lastHourResetTick = currentTick;
    }
  }

  /**
   * Resets all counters for all agents at tick boundary.
   */
  resetAllTicks(currentTick: number, hourPeriod: number = 60): void {
    for (const [agentId, usage] of this.usage) {
      usage.tickTokens = 0;
      usage.lastResetTick = currentTick;

      if (currentTick - usage.lastHourResetTick >= hourPeriod) {
        usage.hourTokens = 0;
        usage.lastHourResetTick = currentTick;
      }
    }
  }

  getUsage(agentId: string): TokenUsage | undefined {
    return this.usage.get(agentId);
  }

  clear(): void {
    this.usage.clear();
  }
}
