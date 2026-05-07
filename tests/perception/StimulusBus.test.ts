import { describe, it, expect } from "vitest";
import { StimulusBus, createStimulusId } from "../../src/perception/StimulusBus.js";
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

describe("StimulusBus", () => {
  it("retains the current tick and evicts older ones beyond the window", () => {
    const bus = new StimulusBus(2);
    bus.newTick(1);
    bus.publish(makeStim({ tick: 1 }));
    bus.newTick(2);
    bus.publish(makeStim({ tick: 2 }));
    bus.newTick(3);
    expect(bus.getForTick(1)).toHaveLength(0);
    expect(bus.getForTick(2)).toHaveLength(1);
  });

  it("indexes by source", () => {
    const bus = new StimulusBus();
    bus.newTick(1);
    bus.publish(makeStim({ source: { kind: "agent", id: "alice" } }));
    bus.publish(makeStim({ source: { kind: "agent", id: "bob" } }));
    bus.publish(makeStim({ source: { kind: "agent", id: "alice" } }));

    expect(bus.getBySource("alice", 1)).toHaveLength(2);
    expect(bus.getBySource("bob", 1)).toHaveLength(1);
    expect(bus.getBySource("eve", 1)).toHaveLength(0);
  });

  it("indexes by kind", () => {
    const bus = new StimulusBus();
    bus.newTick(1);
    bus.publish(makeStim({ kind: "speech" }));
    bus.publish(makeStim({ kind: "sound", channel: "sound" }));
    bus.publish(makeStim({ kind: "smell", channel: "smell" }));

    expect(bus.getByKind("speech", 1)).toHaveLength(1);
    expect(bus.getByKind("sound", 1)).toHaveLength(1);
    expect(bus.getByKind("smell", 1)).toHaveLength(1);
    expect(bus.getByKind("sight", 1)).toHaveLength(0);
  });

  it("createStimulusId returns unique ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(createStimulusId());
    expect(ids.size).toBe(100);
  });
});
