import { describe, it, expect } from "vitest";
import { TopicTracker } from "../../src/perception/TopicTracker.js";
import { createStimulusId } from "../../src/perception/StimulusBus.js";
import type { Stimulus } from "../../src/types/StimulusTypes.js";

function makeStim(overrides: Partial<Stimulus> = {}): Stimulus {
  return {
    id: createStimulusId(),
    kind: "speech",
    channel: "sound",
    source: { kind: "agent", id: "alice" },
    tick: 1,
    intensity: 0.7,
    payload: { text: "ciao" },
    ...overrides,
  };
}

describe("TopicTracker", () => {
  it("opens a fresh topic for a stimulus with no parents", () => {
    const tt = new TopicTracker();
    const a = makeStim({ tick: 1 });
    const id = tt.ingest(a);
    expect(id).toBeTruthy();
    expect(tt.topicOf(a.id)).toBe(id);
  });

  it("threads stimuli connected by causedByStimulusId", () => {
    const tt = new TopicTracker();
    const a = makeStim({ tick: 1 });
    const b = makeStim({
      tick: 2,
      source: { kind: "agent", id: "bob" },
      causedByStimulusId: a.id,
    });
    const idA = tt.ingest(a);
    const idB = tt.ingest(b);
    expect(idA).toBe(idB);
    expect(tt.getTopic(idA)?.participants.has("bob")).toBe(true);
  });

  it("reuses the same topic for the same speaker within the window", () => {
    const tt = new TopicTracker({ windowTicks: 3 });
    const a = makeStim({ tick: 1 });
    const b = makeStim({ tick: 2 });
    const idA = tt.ingest(a);
    const idB = tt.ingest(b);
    expect(idA).toBe(idB);
  });

  it("opens a new topic when the speaker has been silent past the window", () => {
    const tt = new TopicTracker({ windowTicks: 2 });
    const a = makeStim({ tick: 1 });
    const idA = tt.ingest(a);
    const b = makeStim({ tick: 10 });
    const idB = tt.ingest(b);
    expect(idA).not.toBe(idB);
  });

  it("respects an explicit stimulus.topicId", () => {
    const tt = new TopicTracker();
    const a = makeStim({ topicId: "fishing" });
    const idA = tt.ingest(a);
    expect(idA).toBe("fishing");
    expect(tt.getTopic("fishing")).toBeTruthy();
  });

  it("uses the integrator-provided semantic classifier when set", () => {
    const tt = new TopicTracker({
      windowTicks: 5,
      classify: (_stim, openTopics) => openTopics[0]?.id ?? null,
    });
    const a = makeStim({ tick: 1, source: { kind: "agent", id: "alice" } });
    const b = makeStim({ tick: 2, source: { kind: "agent", id: "bob" } });
    const idA = tt.ingest(a);
    const idB = tt.ingest(b);
    expect(idA).toBe(idB);
  });

  it("expires stale topics", () => {
    const tt = new TopicTracker({ windowTicks: 2 });
    const a = makeStim({ tick: 1 });
    tt.ingest(a);
    tt.expireStale(10);
    expect(tt.size).toBe(0);
  });
});
