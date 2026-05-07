/**
 * A drive whose intensity changes over time (hunger, fatigue, fear,
 * curiosity, …). The engine treats `Need` as a passive primitive: it tracks
 * values, applies decay/regen per tick, and exposes the state. *Reacting*
 * to a need (turning hunger into a `find_food` goal) is the agent's job —
 * surfaced via the prompt.
 *
 * All values are normalized to [0, 1]. Conventionally:
 *   - `0` = perfectly satisfied / dormant
 *   - `1` = critical / unbearable
 *
 * Decay/regen is per-tick. Use `tickIntervalMs` on the world to map
 * "ticks" to wall-clock pacing if needed.
 */
export interface Need {
  id: string;
  /** Display label. Engine-internal, used in prompts and reports. */
  label?: string | undefined;
  /** Current intensity in [0, 1]. */
  value: number;
  /**
   * Increment per tick when no satisfier is acting. E.g. hunger grows by
   * `0.02` each tick.
   */
  decayPerTick?: number | undefined;
  /**
   * Decrement per tick when a satisfier is currently acting (e.g. eating
   * reduces hunger). Applied externally — the engine merely supports the
   * book-keeping.
   */
  regenPerTick?: number | undefined;
  /**
   * Threshold above which the need is considered "active" and starts
   * influencing salience and goals. Default `0.5`.
   */
  activationThreshold?: number | undefined;
  /**
   * Threshold above which the need is considered critical (engine may pause
   * the agent or trigger an emergency goal). Default `0.9`.
   */
  criticalThreshold?: number | undefined;
  /**
   * Free-form tags used by the AttentionPolicy to match stimuli with this
   * need (e.g. `["food", "smell"]` for hunger). When a percept's payload or
   * metadata matches one of these tags, salience is boosted.
   */
  tags?: string[] | undefined;
}

/**
 * Aggregate set of needs for an agent or entity.
 */
export interface NeedsState {
  needs: Need[];
}

/**
 * Built-in need templates. Integrators can extend or replace them. The
 * `humanBasic` and `animalBasic` templates are intentionally minimal — they
 * give a starting point without locking in a specific psychology.
 */
export type NeedsTemplate = "none" | "humanBasic" | "animalBasic" | "custom";
