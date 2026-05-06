import { describe, expect, it } from "vitest";
import { IntraTickTimeline } from "../../src/engine/IntraTickTimeline.js";
import type { Message } from "../../src/messaging/Message.js";

function message(id: string, offset: number): Message {
  return {
    id,
    from: "alice",
    to: "bob",
    type: "speak",
    content: id,
    tick: 1,
    metadata: {
      tickSequence: 1,
      simulatedAtOffsetMs: offset,
      intraTickMs: offset,
      emittedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("IntraTickTimeline", () => {
  it("creates monotonic events and resets per tick", () => {
    const timeline = new IntraTickTimeline();
    timeline.reset(1);

    expect(timeline.nextEvent({ atOffsetMs: 100 }).tickSequence).toBe(1);
    expect(timeline.nextEvent({ atOffsetMs: 50 }).simulatedAtOffsetMs).toBe(100);

    timeline.reset(2);
    const nextTick = timeline.nextEvent();
    expect(nextTick.tickSequence).toBe(1);
    expect(nextTick.simulatedAtOffsetMs).toBe(0);
  });

  it("schedules actions after observed messages and thinking delay", () => {
    const timeline = new IntraTickTimeline();
    timeline.reset(1);

    const metadata = timeline.reserveAction({
      agentId: "bob",
      actionType: "speak",
      observedMessages: [message("m1", 1500)],
      iterationIndex: 0,
      thinkingDelayMs: 500,
    });

    expect(metadata.observedMessageIds).toEqual(["m1"]);
    expect(metadata.startedThinkingAtOffsetMs).toBe(1500);
    expect(metadata.finishedThinkingAtOffsetMs).toBe(2000);
    expect(metadata.actionAtOffsetMs).toBe(2000);
    expect(metadata.simulatedAtOffsetMs).toBe(2000);
  });
});
