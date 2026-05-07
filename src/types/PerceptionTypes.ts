import type { PerceptionChannel, Stimulus } from "./StimulusTypes.js";

/**
 * Per-channel sensory configuration for an agent or entity.
 *
 * The same agent typically declares one `SenseConfig` per channel they have
 * access to. Examples:
 *   - human: `[{ channel: "sound", radiusKm: 0.05 }, { channel: "sight", radiusKm: 0.03 }, { channel: "language" }]`
 *   - dog:   `[{ channel: "sound", radiusKm: 0.2 }, { channel: "smell", radiusKm: 0.5 }, { channel: "sight", radiusKm: 0.05 }]`
 *
 * The `language` channel is special: it has no physical range. Any `speech`
 * stimulus the agent already perceives via `sound` is upgraded to an
 * intelligible percept when the agent has a `language` sense matching the
 * stimulus' `metadata.language` (or no language metadata at all).
 */
export interface SenseConfig {
  channel: PerceptionChannel;
  /**
   * Maximum range at which the agent can pick up a stimulus on this channel
   * (km). Ignored for channels that bypass physics (`signal`, `event`,
   * `language`).
   */
  radiusKm?: number | undefined;
  /**
   * Sensitivity multiplier applied to incoming intensity. Default `1.0`.
   * Values < 1 mean the agent is hard-of-hearing/short-sighted on this
   * channel; values > 1 model superhuman senses.
   */
  sensitivity?: number | undefined;
  /**
   * If true, line-of-sight / line-of-smell rules apply (delegated to a
   * `LineOfSightProvider` plugin). Off by default to keep the engine
   * dependency-free.
   */
  occlusionAware?: boolean | undefined;
  /**
   * For `language` channel only — list of BCP-47 codes the agent understands.
   * If absent, any language is intelligible.
   */
  languages?: string[] | undefined;
  /**
   * Stimuli below this perceived intensity are dropped before reaching
   * attention. Default `0` (everything passes through). Useful for noisy
   * worlds where floor noise should not consume attention budget.
   */
  perceptionFloor?: number | undefined;
}

/**
 * A `Percept` is the receiver-facing view of a `Stimulus`: same content, but
 * already filtered through the receiver's senses (intensity attenuated,
 * intelligibility resolved) and ready to be ranked by the attention layer.
 */
export interface Percept {
  /** The stimulus that gave rise to this percept. Reference-only. */
  stimulus: Stimulus;
  /** Channel through which this agent perceived the stimulus. */
  via: PerceptionChannel;
  /**
   * Distance from receiver to source in km. `0` for `signal` / `event` and
   * other physics-bypassing channels.
   */
  distanceKm: number;
  /**
   * Effective intensity at the receiver, in [0, 1]. Already includes
   * sensitivity and decay.
   */
  perceivedIntensity: number;
  /**
   * For `speech` only: 0 = not understood at all (agent perceives a "voice"),
   * 1 = fully intelligible. Engines that don't model partial intelligibility
   * just emit `0` or `1`.
   */
  intelligibility?: number | undefined;
  /**
   * Salience score [0, 1] computed by the AttentionPolicy (Phase 2). Absent
   * until the attention layer runs.
   */
  salience?: number | undefined;
  /** Tick this percept was delivered on. Mirrors `stimulus.tick`. */
  tick: number;
}

/**
 * Optional pre-attention filter, applied right after perception and before
 * salience scoring. Plugins can use this to inject world-specific rules
 * (e.g. "agents wearing earplugs ignore sound stimuli below 0.5").
 */
export type PerceptionFilter = (percept: Percept, agentId: string) => boolean;

/**
 * Configuration for the agent-level attention layer (Phase 2). Kept here so
 * Phase 0 can already type it; the actual policy lives in Phase 2.
 */
export interface AttentionConfig {
  /**
   * Maximum number of percepts that reach the LLM prompt per tick. Beyond
   * this cap, only the highest-salience percepts are kept. Default `8`.
   */
  budget?: number | undefined;
  /**
   * Salience threshold below which a percept is ignored entirely. Below the
   * threshold the agent does NOT trigger an LLM call (no forced response).
   * Default `0.1`.
   */
  threshold?: number | undefined;
  /**
   * Free-form interest tags. Stimuli whose payload mentions these tags
   * (textual match or `metadata.tags` array) get a salience boost.
   */
  interests?: string[] | undefined;
  /**
   * Multiplier applied to the salience of stimuli sourced from agents the
   * receiver has a strong relationship with. Default `1.0` (no boost).
   */
  relationshipWeight?: number | undefined;
  /**
   * Multiplier applied to the salience of stimuli that match an active need
   * (e.g. food smell when hungry). Default `1.0`.
   */
  needWeight?: number | undefined;
  /**
   * Distractibility, in [0, 1]. Higher values let weaker stimuli pass the
   * threshold; lower values keep the agent focused on high-salience inputs.
   * Default `0.5`.
   */
  distractibility?: number | undefined;
}
