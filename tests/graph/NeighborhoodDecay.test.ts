import { describe, it, expect, beforeEach } from "vitest";
import { NeighborhoodManager } from "../../src/graph/NeighborhoodManager.js";
import { InMemoryGraphStore } from "../../src/stores/InMemoryGraphStore.js";
import type { Relationship } from "../../src/types/GraphTypes.js";
import type { RelationshipMeta } from "../../src/plugins/built-in/RelationshipPlugin.js";

function makeMeta(status: RelationshipMeta["status"]): Record<string, unknown> {
  return {
    status,
    declaredBy: [],
    socialWitnesses: [],
    typeId: "friend",
    proposedAt: 0,
  } as unknown as Record<string, unknown>;
}

describe("NeighborhoodManager — differentiated decay", () => {
  let manager: NeighborhoodManager;
  let graphStore: InMemoryGraphStore;

  beforeEach(() => {
    manager = new NeighborhoodManager();
    graphStore = new InMemoryGraphStore();
    manager.configure("a", { decayRate: 0.1, minStrength: 0.05 });
  });

  it("validated relationships decay at 0.25x rate", async () => {
    await graphStore.addRelationship({
      from: "a", to: "b", type: "friend", strength: 0.8,
      since: 0, lastInteraction: 0,
      metadata: makeMeta("validated"),
    });

    await manager.decayRelationships("a", 10, graphStore);

    const rel = await graphStore.getRelationship("a", "b", "friend");
    // 0.8 - (0.1 * 10 * 0.25) = 0.8 - 0.25 = 0.55
    expect(rel).not.toBeNull();
    expect(rel!.strength).toBeCloseTo(0.55);
  });

  it("mutual relationships decay at 0.5x rate", async () => {
    await graphStore.addRelationship({
      from: "a", to: "b", type: "friend", strength: 0.6,
      since: 0, lastInteraction: 0,
      metadata: makeMeta("mutual"),
    });

    await manager.decayRelationships("a", 5, graphStore);

    const rel = await graphStore.getRelationship("a", "b", "friend");
    // 0.6 - (0.1 * 5 * 0.5) = 0.6 - 0.25 = 0.35
    expect(rel).not.toBeNull();
    expect(rel!.strength).toBeCloseTo(0.35);
  });

  it("broken relationships decay at 2x rate", async () => {
    await graphStore.addRelationship({
      from: "a", to: "b", type: "friend", strength: 0.5,
      since: 0, lastInteraction: 0,
      metadata: makeMeta("broken"),
    });

    await manager.decayRelationships("a", 2, graphStore);

    const rel = await graphStore.getRelationship("a", "b", "friend");
    // 0.5 - (0.1 * 2 * 2.0) = 0.5 - 0.4 = 0.1
    expect(rel).not.toBeNull();
    expect(rel!.strength).toBeCloseTo(0.1);
  });

  it("relationships without metadata decay at normal rate", async () => {
    await graphStore.addRelationship({
      from: "a", to: "b", type: "knows", strength: 0.5,
      since: 0, lastInteraction: 0,
    });

    await manager.decayRelationships("a", 3, graphStore);

    const rel = await graphStore.getRelationship("a", "b", "knows");
    // 0.5 - (0.1 * 3 * 1.0) = 0.5 - 0.3 = 0.2
    expect(rel).not.toBeNull();
    expect(rel!.strength).toBeCloseTo(0.2);
  });

  it("batch decay also respects status multiplier", async () => {
    await graphStore.addRelationship({
      from: "a", to: "b", type: "friend", strength: 0.8,
      since: 0, lastInteraction: 0,
      metadata: makeMeta("validated"),
    });
    await graphStore.addRelationship({
      from: "a", to: "c", type: "friend", strength: 0.5,
      since: 0, lastInteraction: 0,
      metadata: makeMeta("broken"),
    });

    await manager.decayAndPruneBatch(["a"], 10, graphStore);

    const relB = await graphStore.getRelationship("a", "b", "friend");
    const relC = await graphStore.getRelationship("a", "c", "friend");

    // validated: 0.8 - (0.1 * 10 * 0.25) = 0.55
    expect(relB).not.toBeNull();
    expect(relB!.strength).toBeCloseTo(0.55);

    // broken: 0.5 - (0.1 * 10 * 2.0) = 0.5 - 2.0 → removed (below minStrength)
    expect(relC).toBeNull();
  });
});
