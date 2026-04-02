import type { GraphStore } from "../types/GraphTypes.js";

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
   * Returns the active neighbors for an agent (contacts above min strength threshold).
   * Results are sorted by strength descending and capped at maxContacts.
   */
  async getActiveNeighbors(
    agentId: string,
    graphStore: GraphStore,
  ): Promise<string[]> {
    const config = this.getConfig(agentId);

    const relationships = await graphStore.getRelationships({
      agentId,
      minStrength: config.minStrength,
      limit: config.maxContacts,
    });

    return relationships
      .sort((a, b) => b.strength - a.strength)
      .slice(0, config.maxContacts)
      .map((r) => (r.from === agentId ? r.to : r.from));
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
