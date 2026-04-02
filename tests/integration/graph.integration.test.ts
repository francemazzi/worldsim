import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Neo4jGraphStore } from "./stores/Neo4jGraphStore.js";

const NEO4J_URI = process.env.NEO4J_URI ?? "bolt://localhost:7687";
const NEO4J_USER = process.env.NEO4J_USER ?? "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD ?? "testpassword";

let store: Neo4jGraphStore;

describe.skipIf(!process.env.NEO4J_URI && !process.env.CI)(
  "Neo4jGraphStore integration",
  () => {
    beforeEach(async () => {
      store = new Neo4jGraphStore(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD);
      await store.clearAll();
    });

    afterAll(async () => {
      await store?.disconnect();
    });

    it("add and get relationship", async () => {
      await store.addRelationship({
        from: "alice",
        to: "bob",
        type: "knows",
        strength: 0.7,
        since: 1,
      });

      const rel = await store.getRelationship("alice", "bob", "knows");
      expect(rel).not.toBeNull();
      expect(rel!.strength).toBe(0.7);
      expect(rel!.since).toBe(1);
    });

    it("update relationship", async () => {
      await store.addRelationship({
        from: "alice",
        to: "bob",
        type: "trusts",
        strength: 0.5,
        since: 1,
      });

      await store.updateRelationship("alice", "bob", "trusts", {
        strength: 0.9,
        lastInteraction: 10,
      });

      const rel = await store.getRelationship("alice", "bob", "trusts");
      expect(rel!.strength).toBe(0.9);
      expect(rel!.lastInteraction).toBe(10);
    });

    it("getRelationships filters by minStrength", async () => {
      await store.addRelationship({
        from: "alice",
        to: "bob",
        type: "knows",
        strength: 0.3,
        since: 1,
      });
      await store.addRelationship({
        from: "alice",
        to: "carol",
        type: "trusts",
        strength: 0.8,
        since: 2,
      });

      const results = await store.getRelationships({
        agentId: "alice",
        minStrength: 0.5,
      });
      expect(results).toHaveLength(1);
      expect(results[0].to).toBe("carol");
    });

    it("getRelationships filters by type", async () => {
      await store.addRelationship({
        from: "alice",
        to: "bob",
        type: "knows",
        strength: 0.5,
        since: 1,
      });
      await store.addRelationship({
        from: "alice",
        to: "carol",
        type: "trusts",
        strength: 0.8,
        since: 2,
      });

      const results = await store.getRelationships({
        agentId: "alice",
        relationshipTypes: ["trusts"],
      });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("trusts");
    });

    it("remove relationship", async () => {
      await store.addRelationship({
        from: "alice",
        to: "bob",
        type: "knows",
        strength: 0.5,
        since: 1,
      });

      await store.removeRelationship("alice", "bob", "knows");

      const rel = await store.getRelationship("alice", "bob", "knows");
      expect(rel).toBeNull();
    });

    it("getConnectedAgents returns all connections", async () => {
      await store.addRelationship({
        from: "alice",
        to: "bob",
        type: "knows",
        strength: 0.5,
        since: 1,
      });
      await store.addRelationship({
        from: "carol",
        to: "alice",
        type: "trusts",
        strength: 0.8,
        since: 2,
      });

      const connected = await store.getConnectedAgents("alice");
      expect(connected.sort()).toEqual(["bob", "carol"]);
    });

    it("multi-agent cross-relationships", async () => {
      await store.addRelationship({
        from: "a",
        to: "b",
        type: "knows",
        strength: 0.5,
        since: 1,
      });
      await store.addRelationship({
        from: "b",
        to: "c",
        type: "trusts",
        strength: 0.9,
        since: 2,
      });
      await store.addRelationship({
        from: "c",
        to: "a",
        type: "works_with",
        strength: 0.7,
        since: 3,
      });

      const aRels = await store.getRelationships({ agentId: "a" });
      expect(aRels).toHaveLength(2);

      const bRels = await store.getRelationships({ agentId: "b" });
      expect(bRels).toHaveLength(2);

      const cRels = await store.getRelationships({ agentId: "c" });
      expect(cRels).toHaveLength(2);
    });

    it("returns null for non-existent relationship", async () => {
      const rel = await store.getRelationship("x", "y", "z");
      expect(rel).toBeNull();
    });
  },
);
