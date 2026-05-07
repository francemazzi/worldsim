import type { GeoLocation } from "./LocationTypes.js";
import type { SenseConfig } from "./PerceptionTypes.js";
import type { AffordanceMap } from "./AffordanceTypes.js";
import type { StimulusKind, PerceptionChannel } from "./StimulusTypes.js";

/**
 * Coarse classification of a non-agent entity. Open by design: integrators
 * are expected to add their own kinds via the catch-all `string` and the
 * free-form `subKind`.
 */
export type EntityKind =
  | "object"
  | "animal"
  | "plant"
  | "signal"
  | "vehicle"
  | "venue"
  | string;

/**
 * Persistent state of an entity. Engine-reserved keys:
 *   - `condition`  — health/integrity in [0, 1]
 *   - `quantity`   — fungible amount (e.g. "litres", "fruits left")
 *   - `temperature` — Celsius; used by some affordances/needs
 *   - `active`     — boolean: is the entity currently emitting?
 * Anything else is integrator-defined.
 */
export type EntityState = Record<string, unknown>;

/**
 * Recurrent emission policy for an entity (e.g. a fountain emits the smell
 * of water every tick). The PerceptionEngine drains the registry once per
 * tick and pushes a `Stimulus` for each declared emitter.
 */
export interface EntityEmitter {
  kind: StimulusKind;
  channel: PerceptionChannel;
  /** Intensity at the source. Default `0.5`. */
  intensity?: number | undefined;
  /** Range in km. Default falls back to the receiver's sense radius. */
  rangeKm?: number | undefined;
  /** Free-form payload (e.g. `{ smell: "bread" }`). */
  payload?: unknown;
  /** Emit every N ticks. Default `1` (every tick). */
  everyNTicks?: number | undefined;
  /** Set to false to suspend emission without removing the emitter. */
  enabled?: boolean | undefined;
}

/**
 * A non-agent thing in the world: an object, an animal, a plant, a signal
 * source. Entities can be perceived (they show up as percepts) and
 * interacted with (via affordances). They never run an LLM tick themselves;
 * if you need autonomous behavior, plug it in externally and let the entity
 * emit stimuli as a side-effect.
 */
export interface Entity {
  id: string;
  kind: EntityKind;
  /** Optional finer-grained classifier ("apple", "wolf", "stop_sign"). */
  subKind?: string | undefined;
  /** Human-readable label, used in prompts and reports. */
  name?: string | undefined;
  position?: GeoLocation | undefined;
  state?: EntityState | undefined;
  /** Affordances offered by this entity (eat, sit, ride, talk_to...). */
  affordances?: AffordanceMap | undefined;
  /**
   * Some entities also perceive (e.g. animals). When set, the entity is
   * treated as a perceiver in the PerceptionEngine even though it has no
   * agent tick.
   */
  senses?: SenseConfig[] | undefined;
  /** Continuous emissions (smell, sound, light...). */
  emitters?: EntityEmitter[] | undefined;
  /** Free metadata. */
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Read-only registry of entities. Mirrors `AgentRegistry`'s shape so the
 * PerceptionEngine can treat agents and entities uniformly when resolving
 * sources and perceivers.
 */
export interface EntityRegistry {
  add(entity: Entity): void;
  remove(id: string): void;
  get(id: string): Entity | undefined;
  list(filter?: { kind?: EntityKind; subKind?: string }): Entity[];
  /** Iterate over all entities. Order is unspecified. */
  values(): IterableIterator<Entity>;
  size: number;
  clear(): void;
}
