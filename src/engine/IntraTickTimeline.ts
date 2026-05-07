import type { Message } from "../messaging/Message.js";
import type { AgentAction } from "../types/AgentTypes.js";
import type {
  ThinkingDelayConfig,
  TimelineMetadata,
  TimelineStamp,
} from "../types/TimelineTypes.js";

interface ActionTimingInput {
  agentId: string;
  actionType: AgentAction["actionType"];
  observedMessages: Message[];
  iterationIndex: number;
  thinkingDelayMs?: ThinkingDelayConfig | undefined;
}

interface NextEventOptions {
  atOffsetMs?: number | undefined;
  afterOffsetMs?: number | undefined;
  delayMs?: number | undefined;
}

export class IntraTickTimeline {
  private currentTick = 0;
  private sequence = 0;
  private offsetMs = 0;
  private tickStartedAtMs = Date.now();

  reset(tick: number): void {
    this.currentTick = tick;
    this.sequence = 0;
    this.offsetMs = 0;
    this.tickStartedAtMs = Date.now();
  }

  get tick(): number {
    return this.currentTick;
  }

  get currentOffsetMs(): number {
    return this.offsetMs;
  }

  nextEvent(options: NextEventOptions = {}): TimelineStamp {
    const requestedOffset = Math.max(
      this.offsetMs,
      options.afterOffsetMs ?? 0,
      options.atOffsetMs ?? 0,
    );
    const nextOffset = requestedOffset + (options.delayMs ?? 0);

    this.offsetMs = nextOffset;
    this.sequence += 1;

    return {
      tickSequence: this.sequence,
      simulatedAtOffsetMs: nextOffset,
      intraTickMs: nextOffset,
      emittedAt: new Date(this.tickStartedAtMs + nextOffset).toISOString(),
    };
  }

  reserveAction(input: ActionTimingInput): TimelineMetadata {
    const observedMessageIds = input.observedMessages.map((m) => m.id);
    const latestObservedOffset = input.observedMessages.reduce(
      (max, message) => Math.max(max, getTimelineOffset(message.metadata)),
      0,
    );
    const startedThinkingAtOffsetMs = Math.max(this.offsetMs, latestObservedOffset);
    const thinkingDelayMs = resolveThinkingDelay(input);
    const actionAtOffsetMs = startedThinkingAtOffsetMs + thinkingDelayMs;
    const stamp = this.nextEvent({ atOffsetMs: actionAtOffsetMs });

    return {
      ...stamp,
      ...(observedMessageIds.length > 0 ? { observedMessageIds } : {}),
      startedThinkingAtOffsetMs,
      finishedThinkingAtOffsetMs: actionAtOffsetMs,
      actionAtOffsetMs,
      thinkingDelayMs,
    };
  }
}

export function getTimelineOffset(metadata: TimelineMetadata | undefined): number {
  if (!metadata) return 0;
  return firstNumber(
    metadata.actionAtOffsetMs,
    metadata.simulatedAtOffsetMs,
    metadata.intraTickMs,
  ) ?? 0;
}

export function compareTimelineMetadata(
  a: TimelineMetadata | undefined,
  b: TimelineMetadata | undefined,
): number {
  const offsetDiff = getTimelineOffset(a) - getTimelineOffset(b);
  if (offsetDiff !== 0) return offsetDiff;

  const sequenceDiff = (a?.tickSequence ?? 0) - (b?.tickSequence ?? 0);
  if (sequenceDiff !== 0) return sequenceDiff;

  return String(a?.emittedAt ?? "").localeCompare(String(b?.emittedAt ?? ""));
}

export function compareAgentActionsByTimeline(
  a: AgentAction,
  b: AgentAction,
): number {
  const tickDiff = a.tick - b.tick;
  if (tickDiff !== 0) return tickDiff;

  const temporal = compareTimelineMetadata(a.metadata, b.metadata);
  if (temporal !== 0) return temporal;

  return a.agentId.localeCompare(b.agentId);
}

function resolveThinkingDelay(input: ActionTimingInput): number {
  const configured = input.thinkingDelayMs;
  if (typeof configured === "number") return Math.max(0, Math.round(configured));

  if (configured) {
    const min = Math.max(0, Math.round(configured.minMs));
    const max = Math.max(min, Math.round(configured.maxMs));
    if (max === min) return min;
    return min + (stableHash(`${input.agentId}:${input.iterationIndex}:${input.actionType}`) % (max - min + 1));
  }

  const baseByAction: Record<AgentAction["actionType"], number> = {
    speak: 900,
    observe: 350,
    interact: 1200,
    tool_call: 1500,
    finish: 200,
    perceive: 250,
  };
  const observedCost = input.observedMessages.length * 300;
  const iterationCost = input.iterationIndex * 200;

  return baseByAction[input.actionType] + observedCost + iterationCost;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function firstNumber(...values: Array<number | undefined>): number | undefined {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value));
}
