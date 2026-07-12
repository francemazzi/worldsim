export interface TimelineStamp {
  /** Monotonic sequence number within the current tick. */
  tickSequence: number;
  /** Simulated milliseconds elapsed since the beginning of the current tick. */
  simulatedAtOffsetMs: number;
  /** Alias kept for callers that describe the same value as intra-tick time. */
  intraTickMs: number;
  /** Real timestamp corresponding to when the event was stamped. */
  emittedAt: string;
}

export interface TimelineMetadata extends Partial<TimelineStamp> {
  /**
   * Namespaced integrator metadata preserved across actions, messages, and
   * delivery receipts. WorldSim treats every nested key as opaque.
   */
  custom?: Record<string, unknown> | undefined;
  /** Messages or events observed before producing this event. */
  observedMessageIds?: string[] | undefined;
  /** Start of the agent's simulated thinking window within the tick. */
  startedThinkingAtOffsetMs?: number | undefined;
  /** End of the agent's simulated thinking window within the tick. */
  finishedThinkingAtOffsetMs?: number | undefined;
  /** Time at which the action becomes visible in the simulated world. */
  actionAtOffsetMs?: number | undefined;
  /** Simulated delay spent thinking before the action became visible. */
  thinkingDelayMs?: number | undefined;
  /** Explicit conversation id when the event belongs to a managed conversation. */
  conversationId?: string | undefined;
  /** Stable thread id used to group related utterances/actions. */
  threadId?: string | undefined;
  /** Stable audience key used to derive threads outside explicit conversations. */
  audienceKey?: string | undefined;
  /** Perception topic id this action/message belongs to. */
  topicId?: string | undefined;
  /** Stimulus id this action/message is responding to. */
  inResponseTo?: string | undefined;
  /** Stimulus id mirrored by a message in perception mode. */
  stimulusId?: string | undefined;
  /** Optional normalized source intensity for emitted speech stimuli. */
  intensity?: number | undefined;
}

export type ThinkingDelayConfig =
  | number
  | {
    minMs: number;
    maxMs: number;
  };
