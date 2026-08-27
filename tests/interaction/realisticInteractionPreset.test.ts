import { describe, it, expect } from "vitest";
import {
  realisticInteractionPreset,
  officeInteractionPreset,
} from "../../src/interaction/realisticInteractionPreset.js";

describe("realisticInteractionPreset", () => {
  it("returns perception mode with humanBasic needs", () => {
    const preset = realisticInteractionPreset();
    expect(preset.mode).toBe("perception");
    expect(preset.disableBroadcastFallback).toBe(true);
    expect(preset.defaultNeedsTemplate).toBe("humanBasic");
    expect(preset.autoNeedsSatisfier).toBe(true);
    expect(preset.defaultSenses?.length).toBeGreaterThan(0);
  });

  it("office preset includes shared venue labels", () => {
    const preset = officeInteractionPreset();
    expect(preset.sharedVenueLabels).toContain("open-space");
  });
});
