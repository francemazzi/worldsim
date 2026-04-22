import { describe, it, expect } from "vitest";
import { analyzeNetwork } from "../../src/analysis/NetworkAnalyzer.js";
import type { Relationship } from "../../src/types/GraphTypes.js";
import type { AgentNode } from "../../src/types/ReportTypes.js";

function rel(from: string, to: string, strength = 0.8, tick = 1): Relationship {
  return { from, to, type: "ally", strength, since: tick, lastInteraction: tick };
}

const nodes: AgentNode[] = [
  { agentId: "a", name: "A", role: "person", personality: ["extrovert"], profession: "farmer" },
  { agentId: "b", name: "B", role: "person", personality: ["introvert"], profession: "farmer" },
  { agentId: "c", name: "C", role: "person", personality: ["extrovert"], profession: "engineer" },
  { agentId: "d", name: "D", role: "person", personality: ["introvert"], profession: "engineer" },
];

describe("analyzeNetwork", () => {
  it("returns empty structure when there are no relationships", () => {
    const result = analyzeNetwork({
      finalRelationships: [],
      nodes,
      snapshotsByTick: [{ tick: 0, relationships: [] }],
    });

    expect(result.sociogramFinal.edges).toEqual([]);
    expect(result.centrality).toHaveLength(4);
    for (const c of result.centrality) {
      expect(c.degree).toBe(0);
      expect(c.betweenness).toBe(0);
    }
    expect(result.communities).toEqual([]);
    expect(result.reciprocity).toBe(0);
  });

  it("computes degree and identifies bridge node via betweenness", () => {
    // Star around "b": a-b, c-b, d-b (undirected via two directed edges each)
    const rels: Relationship[] = [
      rel("a", "b"),
      rel("b", "a"),
      rel("c", "b"),
      rel("b", "c"),
      rel("d", "b"),
      rel("b", "d"),
    ];
    const res = analyzeNetwork({
      finalRelationships: rels,
      nodes,
      snapshotsByTick: [{ tick: 1, relationships: rels }],
    });
    const by = Object.fromEntries(res.centrality.map((c) => [c.agentId, c]));
    expect(by.b!.degree).toBeGreaterThan(by.a!.degree);
    expect(by.b!.betweenness).toBeGreaterThan(by.a!.betweenness);
  });

  it("detects connected components above threshold as communities", () => {
    const rels: Relationship[] = [
      rel("a", "b", 0.9),
      rel("b", "a", 0.9),
      rel("c", "d", 0.9),
      rel("d", "c", 0.9),
    ];
    const res = analyzeNetwork({
      finalRelationships: rels,
      nodes,
      snapshotsByTick: [{ tick: 1, relationships: rels }],
    });
    expect(res.communities).toHaveLength(2);
    const memberSets = res.communities.map((c) => [...c.members].sort().join(","));
    expect(memberSets).toContain("a,b");
    expect(memberSets).toContain("c,d");
  });

  it("computes reciprocity as the fraction of symmetric directed edges", () => {
    const rels: Relationship[] = [
      rel("a", "b"),
      rel("b", "a"),
      rel("c", "d"),
    ];
    const res = analyzeNetwork({
      finalRelationships: rels,
      nodes,
      snapshotsByTick: [{ tick: 1, relationships: rels }],
    });
    expect(res.reciprocity).toBeCloseTo(2 / 3, 4);
  });

  it("diffs initial and final relationships into changes", () => {
    const initial: Relationship[] = [rel("a", "b", 0.3, 0)];
    const final: Relationship[] = [
      rel("a", "b", 0.8, 5),
      rel("c", "d", 0.7, 3),
    ];
    const res = analyzeNetwork({
      finalRelationships: final,
      initialRelationships: initial,
      nodes,
      snapshotsByTick: [{ tick: 5, relationships: final }],
    });
    const types = res.relationshipChanges.map((c) => c.type).sort();
    expect(types).toContain("created");
    expect(types).toContain("strengthened");
  });
});
