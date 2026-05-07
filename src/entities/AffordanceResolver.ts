import type { Entity, EntityRegistry } from "../types/EntityTypes.js";
import type { Affordance } from "../types/AffordanceTypes.js";
import type { Percept } from "../types/PerceptionTypes.js";

/**
 * A single affordance available to an agent in a given moment, paired with
 * the entity it operates on.
 */
export interface AvailableAffordance {
  entity: Entity;
  affordance: Affordance;
}

export interface AffordanceResolverDeps {
  entityRegistry: EntityRegistry;
}

/**
 * Computes "what an agent can do right now" by joining the agent's current
 * percepts with the affordances declared on the entities they can perceive.
 *
 * The resolver does NOT enforce `requires`. Plugins are encouraged to read
 * the metadata and apply their own gating logic; the engine only surfaces
 * possibilities.
 */
export class AffordanceResolver {
  constructor(private readonly deps: AffordanceResolverDeps) {}

  /**
   * Returns the affordances of every entity present in the agent's
   * percepts. Duplicates are deduplicated by `(entityId, verb)`.
   */
  fromPercepts(percepts: Percept[]): AvailableAffordance[] {
    const seen = new Set<string>();
    const out: AvailableAffordance[] = [];
    for (const p of percepts) {
      if (p.stimulus.source.kind !== "entity") continue;
      const entity = this.deps.entityRegistry.get(p.stimulus.source.id);
      if (!entity || !entity.affordances) continue;
      for (const aff of entity.affordances) {
        const key = `${entity.id}:${aff.verb}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ entity, affordance: aff });
      }
    }
    return out;
  }

  /**
   * Returns affordances for a hand-picked set of entity ids. Useful when
   * the agent is in a known location and the world wants to surface
   * everything around them, not just what the perception layer captured.
   */
  forEntityIds(entityIds: Iterable<string>): AvailableAffordance[] {
    const seen = new Set<string>();
    const out: AvailableAffordance[] = [];
    for (const id of entityIds) {
      const entity = this.deps.entityRegistry.get(id);
      if (!entity || !entity.affordances) continue;
      for (const aff of entity.affordances) {
        const key = `${entity.id}:${aff.verb}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ entity, affordance: aff });
      }
    }
    return out;
  }

  /**
   * Returns true when the agent currently has an affordance with the given
   * verb available. Convenience for plugins that gate tool execution.
   */
  hasAffordance(percepts: Percept[], verb: string): boolean {
    for (const a of this.fromPercepts(percepts)) {
      if (a.affordance.verb === verb) return true;
    }
    return false;
  }
}
