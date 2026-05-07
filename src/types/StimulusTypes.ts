import type { GeoLocation } from "./LocationTypes.js";
import type { TimelineMetadata } from "./TimelineTypes.js";

/**
 * Coarse classification of a stimulus.
 *
 * - `speech`     — articulate language uttered by an agent. Travels on the
 *                  `sound` channel but carries linguistic content.
 * - `sound`      — non-linguistic noise (a bark, a crash, a song).
 * - `sight`      — anything visible (an entity in the field of view, a flash).
 * - `smell`      — odors. Decay tipically slower than sound but is
 *                  direction-dependent (handled by an optional wind plugin).
 * - `touch`      — physical contact (push, bite, hug).
 * - `signal`     — non-physical, structured signal (radio, GPS, network event,
 *                  in-game UI). Bypasses the physics layer.
 * - `event`      — a world event (policy announcement, weather change). Used
 *                  by integrators to inject narrative shocks while still going
 *                  through the perception layer.
 */
export type StimulusKind =
  | "speech"
  | "sound"
  | "sight"
  | "smell"
  | "touch"
  | "signal"
  | "event";

/**
 * Sensory channels available to an agent.
 *
 * The mapping `kind → channel` is many-to-many on purpose:
 *   `speech` and `sound` both travel on `sound`,
 *   `sight` travels on `sight`,
 *   `smell` on `smell`,
 *   `touch` on `touch`,
 *   `signal` on `signal`,
 *   `event` on `event` (always perceivable, no physics check).
 *
 * `language` is a refinement of `sound`: agents with a `language` sense can
 * understand `speech` payloads. Without it they only perceive a generic
 * "voice" (intelligibility = 0).
 */
export type PerceptionChannel =
  | "sound"
  | "sight"
  | "smell"
  | "touch"
  | "signal"
  | "event"
  | "language";

/**
 * Origin of a stimulus.
 *
 * The `kind` field exists so the perception engine can resolve the source's
 * position via the right registry (agent vs entity) without an extra lookup.
 */
export interface StimulusSource {
  kind: "agent" | "entity" | "world";
  id: string;
}

/**
 * A stimulus is a fact that *happened* in the world during a tick. It is
 * emitted by an agent, an entity, or the world itself, and may be perceived
 * (or not) by other agents based on their senses, position, and attention.
 *
 * Stimuli are tick-bounded: they live in the `StimulusBus` for the tick they
 * are emitted on plus a small decay window. Long-term traces belong to memory
 * stores, not to this bus.
 */
export interface Stimulus {
  id: string;
  kind: StimulusKind;
  /**
   * Default channel a perceiver needs to receive this stimulus. Some kinds
   * map naturally (`sight` → `sight`); others can be overridden (e.g. a
   * `signal` could ride the `sound` channel for a public-address speaker).
   */
  channel: PerceptionChannel;
  source: StimulusSource;
  tick: number;
  /**
   * Physical intensity at the source, normalized 0..1. The perception engine
   * applies inverse-square (or similar) attenuation to compute the
   * `perceivedIntensity` at each receiver.
   */
  intensity: number;
  /**
   * Optional explicit position. When omitted the engine falls back to the
   * source's current position (looked up via agent/entity registry +
   * LocationIndex).
   */
  position?: GeoLocation | undefined;
  /**
   * Audible/visible/olfactory radius in kilometers at full intensity. When
   * absent the engine uses the receiver's `SenseConfig.radiusKm`. Must be set
   * for stimuli emitted by `world` kind sources.
   */
  rangeKm?: number | undefined;
  /**
   * Free-form payload (text, structured object, image ref...). The perception
   * engine never inspects this; it only forwards it to the receiver.
   */
  payload: unknown;
  /**
   * If this stimulus is a direct reaction to another, the originating
   * stimulus id. Used by the topic tracker to thread interactions.
   */
  causedByStimulusId?: string | undefined;
  /**
   * Conversation/topic this stimulus belongs to. Set by the topic tracker
   * (Phase 3) or by the integrator when emitting an event explicitly tied
   * to a thread.
   */
  topicId?: string | undefined;
  /**
   * Free metadata. Engine-reserved keys: `timeline`, `language` (BCP-47).
   */
  metadata?: (Record<string, unknown> & TimelineMetadata) | undefined;
}
