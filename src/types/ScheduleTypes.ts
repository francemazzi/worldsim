export interface ActivitySchedule {
  /** Fraction of ticks where agent is active (0.0-1.0). Default 1.0 (always active). */
  activeTickRatio?: number | undefined;
  /** Minimum ticks to wait between actions. Default 0. */
  cooldownTicks?: number | undefined;
  /** Maximum actions per simulated hour. */
  actionsPerHour?: number | undefined;
  /** Cyclic active/inactive window in ticks. */
  sleepCycle?:
    | {
        activeFrom: number;
        activeTo: number;
        period: number;
      }
    | undefined;
}

export interface TokenBudget {
  /** Max tokens per single tick. */
  perTick?: number | undefined;
  /** Max tokens per simulated hour. */
  perHour?: number | undefined;
  /** Max tokens over agent lifetime. */
  lifetime?: number | undefined;
  /** What to do when budget is exceeded. Default "pause". */
  policy?: "pause" | "degrade" | "stop" | undefined;
}

export interface TokenUsage {
  tickTokens: number;
  hourTokens: number;
  lifetimeTokens: number;
  lastResetTick: number;
  lastHourResetTick: number;
}
