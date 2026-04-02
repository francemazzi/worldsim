import { describe, it, expect, beforeEach } from "vitest";
import { NeighborhoodManager } from "../../src/graph/NeighborhoodManager.js";
import type { GraphStore, Relationship, GraphQuery } from "../../src/types/GraphTypes.js";

class InMemoryGraphStore implements GraphStore {
  private relationships: Relationship[] = [];

  async addRelationship(rel: Relationship): Promise<void> {
    this.relationships.push({ ...rel });
  }

  async updateRelationship(
    from: string,
    to: string,
    type: string,
    updates: Partial<Relationship>,
  ): Promise<void> {
    const rel = this.relationships.find(
      (r) => r.from === from && r.to === to && r.type === type,
    );
    if (rel) Object.assign(rel, updates);
  }

  async getRelationships(query: GraphQuery): Promise<Relationship[]> {
    let results = this.relationships.filter(
      (r) => r.from === query.agentId || r.to === query.agentId,
    );
    if (query.minStrength != null) {
      results = results.filter((r) => r.strength >= query.minStrength!);
    }
    if (query.relationshipTypes?.length) {
      results = results.filter((r) => query.relationshipTypes!.includes(r.type));
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
    return (
      this.relationships.find(
        (r) => r.from === from && r.to === to && r.type === type,
      ) ?? null
    );
  }

  async removeRelationship(from: string, to: string, type: string): Promise<void> {
    this.relationships = this.relationships.filter(
      (r) => !(r.from === from && r.to === to && r.type === type),
    );
  }

  async getConnectedAgents(agentId: string): Promise<string[]> {
    const connected = new Set<string>();
    for (const r of this.relationships) {
      if (r.from === agentId) connected.add(r.to);
      if (r.to === agentId) connected.add(r.from);
    }
    return Array.from(connected);
  }

  getAll(): Relationship[] {
    return [...this.relationships];
  }
}

describe("NeighborhoodManager", () => {
  let manager: NeighborhoodManager;
  let graphStore: InMemoryGraphStore;

  beforeEach(() => {
    manager = new NeighborhoodManager();
    graphStore = new InMemoryGraphStore();
  });

  describe("configure", () => {
    it("stores and retrieves config", () => {
      manager.configure("a", { maxContacts: 10, groups: ["family"] });
      const config = manager.getConfig("a");
      expect(config.maxContacts).toBe(10);
      expect(config.groups).toEqual(["family"]);
    });

    it("returns defaults for unconfigured agent", () => {
      const config = manager.getConfig("unknown");
      expect(config.maxContacts).toBe(20);
      expect(config.decayRate).toBe(0.01);
      expect(config.minStrength).toBe(0.05);
      expect(config.groups).toEqual([]);
    });
  });

  describe("getActiveNeighbors", () => {
    it("returns neighbors sorted by strength", async () => {
      await graphStore.addRelationship({ from: "a", to: "b", type: "knows", strength: 0.3, since: 0 });
      await graphStore.addRelationship({ from: "a", to: "c", type: "knows", strength: 0.8, since: 0 });
      await graphStore.addRelationship({ from: "a", to: "d", type: "knows", strength: 0.5, since: 0 });

      const neighbors = await manager.getActiveNeighbors("a", graphStore);
      expect(neighbors).toEqual(["c", "d", "b"]);
    });

    it("respects maxContacts", async () => {
      manager.configure("a", { maxContacts: 2 });

      await graphStore.addRelationship({ from: "a", to: "b", type: "knows", strength: 0.8, since: 0 });
      await graphStore.addRelationship({ from: "a", to: "c", type: "knows", strength: 0.5, since: 0 });
      await graphStore.addRelationship({ from: "a", to: "d", type: "knows", strength: 0.3, since: 0 });

      const neighbors = await manager.getActiveNeighbors("a", graphStore);
      expect(neighbors).toHaveLength(2);
      expect(neighbors).toEqual(["b", "c"]);
    });

    it("filters by minStrength", async () => {
      manager.configure("a", { minStrength: 0.4 });
      await graphStore.addRelationship({ from: "a", to: "b", type: "knows", strength: 0.3, since: 0 });
      await graphStore.addRelationship({ from: "a", to: "c", type: "knows", strength: 0.5, since: 0 });

      const neighbors = await manager.getActiveNeighbors("a", graphStore);
      expect(neighbors).toEqual(["c"]);
    });
  });

  describe("decayRelationships", () => {
    it("reduces strength based on inactivity", async () => {
      await graphStore.addRelationship({
        from: "a", to: "b", type: "knows", strength: 0.5,
        since: 0, lastInteraction: 0,
      });

      manager.configure("a", { decayRate: 0.1 });
      await manager.decayRelationships("a", 3, graphStore);

      const rel = await graphStore.getRelationship("a", "b", "knows");
      expect(rel!.strength).toBeCloseTo(0.2); // 0.5 - 0.1*3
    });

    it("removes relationships below minStrength", async () => {
      await graphStore.addRelationship({
        from: "a", to: "b", type: "knows", strength: 0.1,
        since: 0, lastInteraction: 0,
      });

      manager.configure("a", { decayRate: 0.1, minStrength: 0.05 });
      await manager.decayRelationships("a", 2, graphStore);

      const rel = await graphStore.getRelationship("a", "b", "knows");
      expect(rel).toBeNull();
    });

    it("does not decay recently interacted relationships", async () => {
      await graphStore.addRelationship({
        from: "a", to: "b", type: "knows", strength: 0.5,
        since: 0, lastInteraction: 5,
      });

      await manager.decayRelationships("a", 5, graphStore);

      const rel = await graphStore.getRelationship("a", "b", "knows");
      expect(rel!.strength).toBe(0.5);
    });
  });

  describe("pruneToMax", () => {
    it("keeps only top N relationships by strength", async () => {
      manager.configure("a", { maxContacts: 2 });

      await graphStore.addRelationship({ from: "a", to: "b", type: "knows", strength: 0.8, since: 0 });
      await graphStore.addRelationship({ from: "a", to: "c", type: "knows", strength: 0.3, since: 0 });
      await graphStore.addRelationship({ from: "a", to: "d", type: "knows", strength: 0.5, since: 0 });

      await manager.pruneToMax("a", graphStore);

      const all = graphStore.getAll().filter((r) => r.from === "a");
      expect(all).toHaveLength(2);
      expect(all.map((r) => r.to).sort()).toEqual(["b", "d"]);
    });

    it("does nothing when under limit", async () => {
      manager.configure("a", { maxContacts: 10 });
      await graphStore.addRelationship({ from: "a", to: "b", type: "knows", strength: 0.5, since: 0 });

      await manager.pruneToMax("a", graphStore);

      const all = graphStore.getAll();
      expect(all).toHaveLength(1);
    });
  });

  describe("groups", () => {
    it("finds members in the same group", () => {
      manager.configure("a", { groups: ["family", "work"] });
      manager.configure("b", { groups: ["family"] });
      manager.configure("c", { groups: ["friends"] });
      manager.configure("d", { groups: ["work"] });

      const members = manager.getGroupMembers("a");
      expect(members.sort()).toEqual(["b", "d"]);
    });

    it("returns empty for agent with no groups", () => {
      manager.configure("a", { groups: [] });
      expect(manager.getGroupMembers("a")).toEqual([]);
    });
  });
});
