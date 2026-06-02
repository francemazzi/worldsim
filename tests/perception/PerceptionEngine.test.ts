import { describe, it, expect } from "vitest";
import { StimulusBus, createStimulusId } from "../../src/perception/StimulusBus.js";
import { PerceptionEngine } from "../../src/perception/PerceptionEngine.js";
import { LocationIndex } from "../../src/location/LocationIndex.js";
import type { Stimulus } from "../../src/types/StimulusTypes.js";
import type { GeoLocation } from "../../src/types/LocationTypes.js";

function speech(
  fromId: string,
  position: GeoLocation,
  intensity = 0.8,
  language?: string,
): Stimulus {
  return {
    id: createStimulusId(),
    kind: "speech",
    channel: "sound",
    source: { kind: "agent", id: fromId },
    tick: 1,
    intensity,
    payload: { text: "ciao" },
    position,
    rangeKm: 0.05,
    ...(language ? { metadata: { language } } : {}),
  };
}

describe("PerceptionEngine — Phase 1", () => {
  it("delivers a sound percept to a nearby perceiver and not to a far one", () => {
    const idx = new LocationIndex();
    idx.update("alice", { latitude: 45.0, longitude: 9.0 });
    idx.update("bob", { latitude: 45.0001, longitude: 9.0001 }); // ~14m
    idx.update("dan", { latitude: 46.0, longitude: 9.0 });       // ~111km

    const engine = new PerceptionEngine({ locationIndex: idx });
    engine.registerAgent("alice", [{ channel: "sound", radiusKm: 0.05 }]);
    engine.registerAgent("bob", [{ channel: "sound", radiusKm: 0.05 }]);
    engine.registerAgent("dan", [{ channel: "sound", radiusKm: 0.05 }]);

    const bus = new StimulusBus();
    bus.newTick(1);
    bus.publish(speech("alice", { latitude: 45.0, longitude: 9.0 }));

    expect(engine.perceiveFor("alice", bus, 1)).toHaveLength(0);
    expect(engine.perceiveFor("bob", bus, 1)).toHaveLength(1);
    expect(engine.perceiveFor("dan", bus, 1)).toHaveLength(0);
  });

  it("attenuates intensity with distance", () => {
    const idx = new LocationIndex();
    idx.update("alice", { latitude: 45.0, longitude: 9.0 });
    idx.update("near", { latitude: 45.0, longitude: 9.0 });
    idx.update("far", { latitude: 45.00040, longitude: 9.0 });

    const engine = new PerceptionEngine({ locationIndex: idx });
    engine.registerAgent("near", [{ channel: "sound", radiusKm: 0.1 }]);
    engine.registerAgent("far", [{ channel: "sound", radiusKm: 0.1 }]);

    const bus = new StimulusBus();
    bus.newTick(1);
    bus.publish(speech("alice", { latitude: 45.0, longitude: 9.0 }, 1));

    const near = engine.perceiveFor("near", bus, 1);
    const far = engine.perceiveFor("far", bus, 1);
    expect(near[0]!.perceivedIntensity).toBeCloseTo(1, 2);
    expect(far[0]!.perceivedIntensity).toBeLessThan(near[0]!.perceivedIntensity);
  });

  it("blocks self-perception", () => {
    const idx = new LocationIndex();
    idx.update("alice", { latitude: 0, longitude: 0 });

    const engine = new PerceptionEngine({ locationIndex: idx });
    engine.registerAgent("alice", [{ channel: "sound", radiusKm: 1 }]);

    const bus = new StimulusBus();
    bus.newTick(1);
    bus.publish(speech("alice", { latitude: 0, longitude: 0 }));

    expect(engine.perceiveFor("alice", bus, 1)).toHaveLength(0);
  });

  it("language sense gates intelligibility for speech", () => {
    const idx = new LocationIndex();
    idx.update("alice", { latitude: 0, longitude: 0 });
    idx.update("bob", { latitude: 0, longitude: 0 });
    idx.update("yuki", { latitude: 0, longitude: 0 });
    idx.update("eve", { latitude: 0, longitude: 0 });

    const engine = new PerceptionEngine({ locationIndex: idx });
    engine.registerAgent("bob", [
      { channel: "sound", radiusKm: 1 },
      { channel: "language", languages: ["it"] },
    ]);
    engine.registerAgent("yuki", [
      { channel: "sound", radiusKm: 1 },
      { channel: "language", languages: ["ja"] },
    ]);
    engine.registerAgent("eve", [
      { channel: "sound", radiusKm: 1 },
    ]);

    const bus = new StimulusBus();
    bus.newTick(1);
    bus.publish(speech("alice", { latitude: 0, longitude: 0 }, 1, "it"));

    expect(engine.perceiveFor("bob", bus, 1)[0]!.intelligibility).toBe(1);
    expect(engine.perceiveFor("yuki", bus, 1)[0]!.intelligibility).toBe(0);
    expect(engine.perceiveFor("eve", bus, 1)[0]!.intelligibility).toBe(0);
  });

  it("signal channel bypasses physics (range-independent)", () => {
    const idx = new LocationIndex();
    idx.update("alice", { latitude: 0, longitude: 0 });
    idx.update("dan", { latitude: 50, longitude: 50 });

    const engine = new PerceptionEngine({ locationIndex: idx });
    engine.registerAgent("dan", [{ channel: "signal" }]);

    const bus = new StimulusBus();
    bus.newTick(1);
    bus.publish({
      id: createStimulusId(),
      kind: "signal",
      channel: "signal",
      source: { kind: "agent", id: "alice" },
      tick: 1,
      intensity: 1,
      payload: { kind: "broadcast" },
    });

    const got = engine.perceiveFor("dan", bus, 1);
    expect(got).toHaveLength(1);
    expect(got[0]!.distanceKm).toBe(0);
  });

  it("perceptionFloor drops sub-threshold percepts", () => {
    const idx = new LocationIndex();
    idx.update("alice", { latitude: 0, longitude: 0 });
    idx.update("bob", { latitude: 0.0003, longitude: 0 });

    const engine = new PerceptionEngine({ locationIndex: idx });
    engine.registerAgent("bob", [
      { channel: "sound", radiusKm: 0.1, perceptionFloor: 0.95 },
    ]);

    const bus = new StimulusBus();
    bus.newTick(1);
    bus.publish(speech("alice", { latitude: 0, longitude: 0 }, 0.5));

    expect(engine.perceiveFor("bob", bus, 1)).toHaveLength(0);
  });

  it("perceiveAll returns one entry per perceiver that heard something", () => {
    const idx = new LocationIndex();
    idx.update("alice", { latitude: 0, longitude: 0 });
    idx.update("bob", { latitude: 0, longitude: 0 });
    idx.update("eve", { latitude: 50, longitude: 50 });

    const engine = new PerceptionEngine({ locationIndex: idx });
    engine.registerAgent("alice", [{ channel: "sound", radiusKm: 1 }]);
    engine.registerAgent("bob", [{ channel: "sound", radiusKm: 1 }]);
    engine.registerAgent("eve", [{ channel: "sound", radiusKm: 1 }]);

    const bus = new StimulusBus();
    bus.newTick(1);
    bus.publish(speech("alice", { latitude: 0, longitude: 0 }));

    const all = engine.perceiveAll(bus, 1);
    expect(all.has("bob")).toBe(true);
    expect(all.has("eve")).toBe(false);
    expect(all.has("alice")).toBe(false);
  });

  it("custom filter can drop percepts (e.g. occlusion plugin)", () => {
    const idx = new LocationIndex();
    idx.update("alice", { latitude: 0, longitude: 0 });
    idx.update("bob", { latitude: 0, longitude: 0 });

    const engine = new PerceptionEngine({ locationIndex: idx });
    engine.registerAgent("bob", [{ channel: "sound", radiusKm: 1 }]);
    engine.addFilter((p, agentId) => agentId !== "bob");

    const bus = new StimulusBus();
    bus.newTick(1);
    bus.publish(speech("alice", { latitude: 0, longitude: 0 }));

    expect(engine.perceiveFor("bob", bus, 1)).toHaveLength(0);
  });

  it("works without a location index (treats all perceivers as co-located)", () => {
    const engine = new PerceptionEngine();
    engine.registerAgent("bob", [{ channel: "sound" }]);

    const bus = new StimulusBus();
    bus.newTick(1);
    bus.publish(speech("alice", { latitude: 0, longitude: 0 }, 1));

    expect(engine.perceiveFor("bob", bus, 1)).toHaveLength(1);
  });
});
