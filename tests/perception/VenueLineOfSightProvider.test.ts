import { describe, it, expect } from "vitest";
import { LocationIndex } from "../../src/location/LocationIndex.js";
import { createVenueLineOfSightFilter } from "../../src/perception/VenueLineOfSightProvider.js";
import type { Percept } from "../../src/types/PerceptionTypes.js";
import type { Stimulus } from "../../src/types/StimulusTypes.js";

function makeSpeechPercept(fromId: string, channel: "sound" | "sight" = "sound"): Percept {
  const stim: Stimulus = {
    id: "s1",
    kind: "speech",
    channel,
    source: { kind: "agent", id: fromId },
    tick: 1,
    intensity: 0.8,
    payload: { text: "ciao" },
  };
  return {
    stimulus: stim,
    via: channel,
    distanceKm: 0.001,
    perceivedIntensity: 0.7,
    tick: 1,
  };
}

describe("VenueLineOfSightProvider", () => {
  it("blocks cross-venue sound between enclosed rooms", () => {
    const index = new LocationIndex();
    index.update("listener", { latitude: 0, longitude: 0, label: "sala-A" });
    index.update("speaker", { latitude: 0.00001, longitude: 0, label: "sala-B" });

    const filter = createVenueLineOfSightFilter(index, ["corridoio", "open-space"]);
    const percept = makeSpeechPercept("speaker");
    expect(filter(percept, "listener")).toBe(false);
  });

  it("allows same-venue perception", () => {
    const index = new LocationIndex();
    index.update("listener", { latitude: 0, longitude: 0, label: "bar" });
    index.update("speaker", { latitude: 0.00001, longitude: 0, label: "bar" });

    const filter = createVenueLineOfSightFilter(index, ["corridoio"]);
    expect(filter(makeSpeechPercept("speaker"), "listener")).toBe(true);
  });
});
