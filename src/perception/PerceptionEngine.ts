import type { GeoLocation } from "../types/LocationTypes.js";
import type {
  Percept,
  PerceptionFilter,
  SenseConfig,
} from "../types/PerceptionTypes.js";
import type {
  PerceptionChannel,
  Stimulus,
  StimulusSource,
} from "../types/StimulusTypes.js";
import type { LocationIndex } from "../location/LocationIndex.js";
import type { StimulusBus } from "./StimulusBus.js";

/**
 * Resolver hook the engine uses to find a non-agent entity's current
 * position. Plugged in by the EntityRegistry once Phase 5 lands; until
 * then a no-op resolver is used (entities have no position).
 */
export type EntityPositionResolver = (entityId: string) => GeoLocation | undefined;

export interface PerceptionEngineDeps {
  locationIndex?: LocationIndex | undefined;
  /**
   * Senses applied to perceivers that don't declare their own.
   */
  defaultSenses?: SenseConfig[] | undefined;
  resolveEntityPosition?: EntityPositionResolver | undefined;
}

interface RegisteredPerceiver {
  id: string;
  kind: "agent" | "entity";
  senses: SenseConfig[];
}

/**
 * Stateless-ish engine that turns the per-tick stimulus stream into a
 * per-perceiver percept stream. Holds a small registry of perceivers (id +
 * senses) and runs the channel rules at query time.
 *
 * Design notes
 * ────────────
 *  - Channels that bypass physics (`signal`, `event`) are delivered to every
 *    perceiver that has a matching sense, regardless of distance.
 *  - Sound/sight/smell/touch use simple linear attenuation:
 *      `perceived = sourceIntensity * sensitivity * (1 - distance/range)`
 *    This is realistic enough for narrative simulations and avoids tuning a
 *    full inverse-square model. Plugins can override via `PerceptionFilter`.
 *  - `language` is a *modifier*: it does not deliver new percepts, it just
 *    upgrades `speech` percepts already coming through `sound` to be
 *    intelligible.
 *  - Optional `LineOfSightProvider` plugins (Phase 6) can hook in by
 *    registering a `PerceptionFilter`.
 */
export class PerceptionEngine {
  private readonly perceivers: Map<string, RegisteredPerceiver> = new Map();
  private readonly filters: PerceptionFilter[] = [];

  constructor(private readonly deps: PerceptionEngineDeps = {}) {}

  // ── Registration ─────────────────────────────────────────────────

  registerAgent(agentId: string, senses?: SenseConfig[]): void {
    const effective = senses && senses.length > 0
      ? senses
      : (this.deps.defaultSenses ?? []);
    this.perceivers.set(agentId, { id: agentId, kind: "agent", senses: effective });
  }

  registerEntity(entityId: string, senses?: SenseConfig[]): void {
    if (!senses || senses.length === 0) return;
    this.perceivers.set(entityId, { id: entityId, kind: "entity", senses });
  }

  unregister(id: string): void {
    this.perceivers.delete(id);
  }

  hasPerceiver(id: string): boolean {
    return this.perceivers.has(id);
  }

  /**
   * Adds a global filter that runs on every percept *after* attenuation but
   * *before* the result is returned to the caller. Returning `false` drops
   * the percept entirely. Useful for line-of-sight / occlusion plugins.
   */
  addFilter(filter: PerceptionFilter): () => void {
    this.filters.push(filter);
    return () => {
      const idx = this.filters.indexOf(filter);
      if (idx >= 0) this.filters.splice(idx, 1);
    };
  }

  // ── Querying ─────────────────────────────────────────────────────

  /**
   * Computes the percepts a single agent receives for a given tick from the
   * supplied stimulus bus. Self-emitted stimuli are filtered out.
   */
  perceiveFor(agentId: string, bus: StimulusBus, tick: number): Percept[] {
    const perceiver = this.perceivers.get(agentId);
    if (!perceiver) return [];
    const stimuli = bus.getForTick(tick);
    return this.computePercepts(perceiver, stimuli);
  }

  /**
   * Bulk variant: percepts for every registered perceiver. Faster than
   * calling `perceiveFor` in a loop because stimulus iteration happens once.
   */
  perceiveAll(bus: StimulusBus, tick: number): Map<string, Percept[]> {
    const result = new Map<string, Percept[]>();
    const stimuli = bus.getForTick(tick);
    for (const perceiver of this.perceivers.values()) {
      const percepts = this.computePercepts(perceiver, stimuli);
      if (percepts.length > 0) result.set(perceiver.id, percepts);
    }
    return result;
  }

  // ── Internals ────────────────────────────────────────────────────

  private computePercepts(perceiver: RegisteredPerceiver, stimuli: Stimulus[]): Percept[] {
    if (stimuli.length === 0 || perceiver.senses.length === 0) return [];

    const senseByChannel = indexSensesByChannel(perceiver.senses);
    const languageSense = senseByChannel.get("language");
    const out: Percept[] = [];

    for (const stim of stimuli) {
      if (stim.source.id === perceiver.id) continue;

      const sense = senseByChannel.get(stim.channel);
      if (!sense) continue;

      const distance = this.computeDistance(stim, perceiver.id);
      if (distance === null) continue;

      const range = effectiveRange(stim, sense);
      const physicsBypass = isPhysicsBypassChannel(stim.channel);

      if (!physicsBypass && distance > range) continue;

      const sensitivity = sense.sensitivity ?? 1;
      const attenuation = physicsBypass
        ? 1
        : Math.max(0, 1 - distance / Math.max(range, Number.EPSILON));
      const perceivedIntensity = clamp01(stim.intensity * sensitivity * attenuation);

      const floor = sense.perceptionFloor ?? 0;
      if (perceivedIntensity < floor) continue;

      const intelligibility = computeIntelligibility(stim, languageSense);

      const percept: Percept = {
        stimulus: stim,
        via: stim.channel,
        distanceKm: physicsBypass ? 0 : distance,
        perceivedIntensity,
        ...(intelligibility != null ? { intelligibility } : {}),
        tick: stim.tick,
      };

      if (this.filters.length > 0) {
        let keep = true;
        for (const filter of this.filters) {
          if (!filter(percept, perceiver.id)) {
            keep = false;
            break;
          }
        }
        if (!keep) continue;
      }

      out.push(percept);
    }

    return out;
  }

  private computeDistance(stim: Stimulus, perceiverId: string): number | null {
    if (isPhysicsBypassChannel(stim.channel)) return 0;
    const idx = this.deps.locationIndex;
    // No spatial index → world has no geography. Treat all perceivers as
    // co-located (distance 0) so perception still works in pure-relational
    // simulations.
    if (!idx) return 0;
    const perceiverLoc = idx.getLocation(perceiverId);
    if (!perceiverLoc) return Infinity;
    const sourceLoc = this.resolveSourcePosition(stim);
    if (!sourceLoc) return Infinity;
    return haversineKm(sourceLoc, perceiverLoc);
  }

  private resolveSourcePosition(stim: Stimulus): GeoLocation | undefined {
    if (stim.position) return stim.position;
    return resolveSourcePosition(
      stim.source,
      this.deps.locationIndex,
      this.deps.resolveEntityPosition,
    );
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function indexSensesByChannel(senses: SenseConfig[]): Map<PerceptionChannel, SenseConfig> {
  const m = new Map<PerceptionChannel, SenseConfig>();
  for (const s of senses) m.set(s.channel, s);
  return m;
}

function effectiveRange(stim: Stimulus, sense: SenseConfig): number {
  if (typeof stim.rangeKm === "number") return stim.rangeKm;
  if (typeof sense.radiusKm === "number") return sense.radiusKm;
  return Infinity;
}

function isPhysicsBypassChannel(channel: PerceptionChannel): boolean {
  return channel === "signal" || channel === "event";
}

function computeIntelligibility(
  stim: Stimulus,
  languageSense: SenseConfig | undefined,
): number | undefined {
  if (stim.kind !== "speech") return undefined;
  if (!languageSense) return 0;
  const speechLang = (stim.metadata as Record<string, unknown> | undefined)?.["language"];
  const langs = languageSense.languages;
  if (!langs || langs.length === 0) return 1;
  if (typeof speechLang !== "string") return 1;
  return langs.includes(speechLang) ? 1 : 0;
}

function resolveSourcePosition(
  source: StimulusSource,
  locationIndex: LocationIndex | undefined,
  entityResolver: EntityPositionResolver | undefined,
): GeoLocation | undefined {
  if (source.kind === "agent") {
    return locationIndex?.getLocation(source.id);
  }
  if (source.kind === "entity") {
    return entityResolver?.(source.id);
  }
  return undefined;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function haversineKm(a: GeoLocation, b: GeoLocation): number {
  const R = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
