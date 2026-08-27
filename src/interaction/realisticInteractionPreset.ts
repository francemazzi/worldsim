import type { InteractionConfig } from "../types/WorldTypes.js";

/**
 * Canonical interaction preset for human community simulations (village,
 * office, family). Enables perception mode, strict routing, default
 * human needs and typical human senses.
 */
export function realisticInteractionPreset(
  overrides: Partial<InteractionConfig> = {},
): InteractionConfig {
  return {
    mode: "perception",
    disableBroadcastFallback: true,
    defaultNeedsTemplate: "humanBasic",
    topicWindowTicks: 5,
    autoNeedsSatisfier: true,
    defaultSenses: [
      { channel: "sound", radiusKm: 0.05 },
      { channel: "sight", radiusKm: 0.03 },
      { channel: "language", languages: ["it"] },
    ],
    ...overrides,
  };
}

/**
 * Preset tuned for animal enclosures (no language channel by default).
 */
export function animalInteractionPreset(
  overrides: Partial<InteractionConfig> = {},
): InteractionConfig {
  return {
    mode: "perception",
    disableBroadcastFallback: true,
    defaultNeedsTemplate: "animalBasic",
    topicWindowTicks: 4,
    autoNeedsSatisfier: true,
    defaultSenses: [
      { channel: "sound", radiusKm: 0.2, sensitivity: 1.2 },
      { channel: "smell", radiusKm: 0.5 },
      { channel: "sight", radiusKm: 0.08 },
    ],
    ...overrides,
  };
}

/**
 * Preset for indoor office simulations with venue-based occlusion.
 */
export function officeInteractionPreset(
  overrides: Partial<InteractionConfig> = {},
): InteractionConfig {
  return {
    mode: "perception",
    disableBroadcastFallback: true,
    defaultNeedsTemplate: "humanBasic",
    topicWindowTicks: 6,
    autoNeedsSatisfier: true,
    sharedVenueLabels: ["corridoio", "open-space", "atrio"],
    defaultSenses: [
      { channel: "sound", radiusKm: 0.008 },
      { channel: "sight", radiusKm: 0.015 },
      { channel: "language", languages: ["it", "en"] },
    ],
    ...overrides,
  };
}
