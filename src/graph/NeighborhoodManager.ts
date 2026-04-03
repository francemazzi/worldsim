import type { GraphStore, Relationship } from "../types/GraphTypes.js";

export interface NeighborhoodConfig {
  /** Maximum number of active contacts. Default 20. */
  maxContacts: number;
  /** Strength decrease per tick of no interaction. Default 0.01. */
  decayRate: number;
  /** Minimum strength to remain in active neighborhood. Default 0.05. */
  minStrength: number;
  /** Group IDs this agent belongs to. */
  groups: string[];
}

const DEFAULT_CONFIG: NeighborhoodConfig = {
  maxContacts: 20,
  decayRate: 0.01,
  minStrength: 0.05,
  groups: [],
};

/**
 * Manages the local neighborhood (social graph) for each agent.
 * Handles relationship decay, pruning, and group-scoped queries.
 */
export class NeighborhoodManager {
  private configs: Map<string, NeighborhoodConfig> = new Map();
  private neighborCache: Map<string, string[]> = new Map();
  private cacheTick = -1;

  /**
   * Registers an agent with its neighborhood configuration.
   */
  configure(agentId: string, config: Partial<NeighborhoodConfig>): void {
    this.configs.set(agentId, { ...DEFAULT_CONFIG, ...config });
  }

  getConfig(agentId: string): NeighborhoodConfig {
    return this.configs.get(agentId) ?? DEFAULT_CONFIG;
  }

  /**
   * Resets the per-tick neighbor cache. Call at the start of each tick.
   */
  resetTickCache(tick: number): void {
    if (tick !== this.cacheTick) {
      this.neighborCache.clear();
      this.cacheTick = tick;
    }
  }

  /**
   * Returns the active neighbors for an agent (contacts above min strength threshold).
   * Results are sorted by strength descending and capped at maxContacts.
   * Uses per-tick cache to avoid repeated GraphStore queries.
   */
  async getActiveNeighbors(
    agentId: string,
    graphStore: GraphStore,
  ): Promise<string[]> {
    const cached = this.neighborCache.get(agentId);
    if (cached) return cached;

    const config = this.getConfig(agentId);

    const relationships = await graphStore.getRelationships({
      agentId,
      minStrength: config.minStrength,
      limit: config.maxContacts,
    });

    const neighbors = relationships
      .sort((a, b) => b.strength - a.strength)
      .slice(0, config.maxContacts)
      .map((r) => (r.from === agentId ? r.to : r.from));

    this.neighborCache.set(agentId, neighbors);
    return neighbors;
  }

  /**
   * Decays all relationships for an agent based on time since last interaction.
   * Removes relationships that fall below minimum strength.
   */
  async decayRelationships(
    agentId: string,
    currentTick: number,
    graphStore: GraphStore,
  ): Promise<void> {
    const config = this.getConfig(agentId);
    const relationships = await graphStore.getRelationships({ agentId });

    for (const rel of relationships) {
      const lastInteraction = rel.lastInteraction ?? rel.since;
      const ticksSinceInteraction = currentTick - lastInteraction;

      if (ticksSinceInteraction <= 0) continue;

      const newStrength = Math.max(0, rel.strength - config.decayRate * ticksSinceInteraction);

      if (newStrength < config.minStrength) {
        await graphStore.removeRelationship(rel.from, rel.to, rel.type);
      } else if (newStrength !== rel.strength) {
        await graphStore.updateRelationship(rel.from, rel.to, rel.type, {
          strength: newStrength,
        });
      }
    }
  }

  /**
   * Prunes contacts to keep only the top N by strength.
   */
  async pruneToMax(
    agentId: string,
    graphStore: GraphStore,
  ): Promise<void> {
    const config = this.getConfig(agentId);
    const relationships = await graphStore.getRelationships({ agentId });

    if (relationships.length <= config.maxContacts) return;

    const sorted = [...relationships].sort((a, b) => b.strength - a.strength);
    const toRemove = sorted.slice(config.maxContacts);

    for (const rel of toRemove) {
      await graphStore.removeRelationship(rel.from, rel.to, rel.type);
    }
  }

  /**
   * Batch decay and prune for multiple agents in a single pass.
   * Fetches all relationships once per agent, applies decay, then prunes.
   * Collects all mutations and applies removals in batch when the store supports it.
   * Agents are processed in parallel.
   */
  async decayAndPruneBatch(
    agentIds: string[],
    currentTick: number,
    graphStore: GraphStore,
  ): Promise<void> {
    const processAgent = async (agentId: string): Promise<void> => {
      const config = this.getConfig(agentId);
      const relationships = await graphStore.getRelationships({ agentId });
      if (relationships.length === 0) return;

      // Pure computation: classify relationships
      const toRemove: Array<{ from: string; to: string; type: string }> = [];
      const toUpdate: Array<{ rel: Relationship; newStrength: number }> = [];
      const survivors: Array<{ rel: Relationship; newStrength: number }> = [];

      for (const rel of relationships) {
        const lastInteraction = rel.lastInteraction ?? rel.since;
        const ticksSinceInteraction = currentTick - lastInteraction;

        if (ticksSinceInteraction <= 0) {
          survivors.push({ rel, newStrength: rel.strength });
          continue;
        }

        const newStrength = Math.max(0, rel.strength - config.decayRate * ticksSinceInteraction);

        if (newStrength < config.minStrength) {
          toRemove.push({ from: rel.from, to: rel.to, type: rel.type });
        } else {
          survivors.push({ rel, newStrength });
          if (newStrength !== rel.strength) {
            toUpdate.push({ rel, newStrength });
          }
        }
      }

      // Prune excess contacts
      if (survivors.length > config.maxContacts) {
        survivors.sort((a, b) => b.newStrength - a.newStrength);
        for (const { rel } of survivors.slice(config.maxContacts)) {
          toRemove.push({ from: rel.from, to: rel.to, type: rel.type });
        }
      }

      // Apply mutations
      await Promise.all(
        toUpdate.map(({ rel, newStrength }) =>
          graphStore.updateRelationship(rel.from, rel.to, rel.type, {
            strength: newStrength,
          }),
        ),
      );

      if (toRemove.length > 0) {
        if (graphStore.removeRelationshipBatch) {
          await graphStore.removeRelationshipBatch(toRemove);
        } else {
          await Promise.all(
            toRemove.map((r) => graphStore.removeRelationship(r.from, r.to, r.type)),
          );
        }
      }
    };

    await Promise.all(agentIds.map(processAgent));
  }

  /**
   * Gets all agents in the same group(s) as the given agent.
   * Queries all agents' configs to find group overlap.
   */
  getGroupMembers(agentId: string): string[] {
    const config = this.getConfig(agentId);
    if (config.groups.length === 0) return [];

    const members: string[] = [];
    const agentGroups = new Set(config.groups);

    for (const [otherId, otherConfig] of this.configs) {
      if (otherId === agentId) continue;
      if (otherConfig.groups.some((g) => agentGroups.has(g))) {
        members.push(otherId);
      }
    }

    return members;
  }

  /**
   * Gets the groups an agent belongs to.
   */
  getGroups(agentId: string): string[] {
    return this.getConfig(agentId).groups;
  }

  clear(): void {
    this.configs.clear();
  }
}
