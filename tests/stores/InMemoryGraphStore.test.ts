import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryGraphStore } from "../helpers/InMemoryGraphStore.js";
import type { Relationship } from "../../src/types/GraphTypes.js";

function makeRel(overrides: Partial<Relationship> = {}): Relationship {
  return {
    from: "agent-1",
    to: "agent-2",
    type: "knows",
    strength: 0.5,
    since: 1,
    ...overrides,
  };
}

describe("InMemoryGraphStore", () => {
  let store: InMemoryGraphStore;

  beforeEach(() => {
    store = new InMemoryGraphStore();
  });

  it("adds and retrieves a relationship", async () => {
    await store.addRelationship(makeRel());
    const rel = await store.getRelationship("agent-1", "agent-2", "knows");
    expect(rel).not.toBeNull();
    expect(rel!.strength).toBe(0.5);
  });

  it("updates a relationship", async () => {
    await store.addRelationship(makeRel());
    await store.updateRelationship("agent-1", "agent-2", "knows", {
      strength: 0.9,
      lastInteraction: 5,
    });
    const rel = await store.getRelationship("agent-1", "agent-2", "knows");
    expect(rel!.strength).toBe(0.9);
    expect(rel!.lastInteraction).toBe(5);
  });

  it("getRelationships filters by agentId", async () => {
    await store.addRelationship(makeRel({ from: "a", to: "b" }));
    await store.addRelationship(makeRel({ from: "c", to: "d" }));
    const results = await store.getRelationships({ agentId: "a" });
    expect(results).toHaveLength(1);
  });

  it("getRelationships filters by type", async () => {
    await store.addRelationship(makeRel({ type: "knows" }));
    await store.addRelationship(
      makeRel({ from: "agent-1", to: "agent-3", type: "trusts" }),
    );
    const results = await store.getRelationships({
      agentId: "agent-1",
      relationshipTypes: ["trusts"],
    });
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe("trusts");
  });

  it("getRelationships filters by minStrength", async () => {
    await store.addRelationship(makeRel({ strength: 0.3 }));
    await store.addRelationship(
      makeRel({ from: "agent-1", to: "agent-3", type: "trusts", strength: 0.8 }),
    );
    const results = await store.getRelationships({
      agentId: "agent-1",
      minStrength: 0.5,
    });
    expect(results).toHaveLength(1);
    expect(results[0].strength).toBe(0.8);
  });

  it("getRelationships respects limit", async () => {
    await store.addRelationship(makeRel({ to: "b" }));
    await store.addRelationship(makeRel({ to: "c", type: "trusts" }));
    await store.addRelationship(makeRel({ to: "d", type: "works_with" }));
    const results = await store.getRelationships({
      agentId: "agent-1",
      limit: 2,
    });
    expect(results).toHaveLength(2);
  });

  it("removes a relationship", async () => {
    await store.addRelationship(makeRel());
    await store.removeRelationship("agent-1", "agent-2", "knows");
    const rel = await store.getRelationship("agent-1", "agent-2", "knows");
    expect(rel).toBeNull();
  });

  it("getConnectedAgents returns all connected agents", async () => {
    await store.addRelationship(makeRel({ from: "a", to: "b" }));
    await store.addRelationship(makeRel({ from: "c", to: "a", type: "trusts" }));
    const connected = await store.getConnectedAgents("a");
    expect(connected.sort()).toEqual(["b", "c"]);
  });

  it("returns null for non-existent relationship", async () => {
    const rel = await store.getRelationship("x", "y", "z");
    expect(rel).toBeNull();
  });
});
