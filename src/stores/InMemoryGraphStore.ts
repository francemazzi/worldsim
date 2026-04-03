import type {
  GraphStore,
  Relationship,
  GraphQuery,
} from "../types/GraphTypes.js";

function relKey(from: string, to: string, type: string): string {
  return `${from}::${to}::${type}`;
}

/**
 * In-memory GraphStore — no external dependencies.
 * Data lives only in the process. Use this when you don't need Neo4j
 * but still want agents to track relationships across ticks.
 */
export class InMemoryGraphStore implements GraphStore {
  private relationships: Map<string, Relationship> = new Map();

  async addRelationship(rel: Relationship): Promise<void> {
    this.relationships.set(relKey(rel.from, rel.to, rel.type), rel);
  }

  async updateRelationship(
    from: string,
    to: string,
    type: string,
    updates: Partial<Relationship>,
  ): Promise<void> {
    const key = relKey(from, to, type);
    const existing = this.relationships.get(key);
    if (existing) {
      this.relationships.set(key, { ...existing, ...updates });
    }
  }

  async getRelationships(query: GraphQuery): Promise<Relationship[]> {
    let results = Array.from(this.relationships.values()).filter(
      (r) => r.from === query.agentId || r.to === query.agentId,
    );

    if (query.relationshipTypes && query.relationshipTypes.length > 0) {
      results = results.filter((r) =>
        query.relationshipTypes!.includes(r.type),
      );
    }

    if (query.minStrength != null) {
      results = results.filter((r) => r.strength >= query.minStrength!);
    }

    if (query.limit != null) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  async getRelationship(
    from: string,
    to: string,
    type: string,
  ): Promise<Relationship | null> {
    return this.relationships.get(relKey(from, to, type)) ?? null;
  }

  async removeRelationship(
    from: string,
    to: string,
    type: string,
  ): Promise<void> {
    this.relationships.delete(relKey(from, to, type));
  }

  async getConnectedAgents(agentId: string): Promise<string[]> {
    const connected = new Set<string>();
    for (const r of this.relationships.values()) {
      if (r.from === agentId) connected.add(r.to);
      if (r.to === agentId) connected.add(r.from);
    }
    return Array.from(connected);
  }
}
