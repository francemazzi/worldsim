import type { Relationship } from "../types/GraphTypes.js";
import type {
  AgentNode,
  CentralityScore,
  Community,
  DensityPoint,
  HomophilyScore,
  NetworkAnalysis,
  RelationshipChange,
  RelationshipSnapshot,
} from "../types/ReportTypes.js";

export interface NetworkAnalyzerInput {
  /** Final snapshot of the relationship graph. */
  finalRelationships: Relationship[];
  /** Initial snapshot (or empty if unknown). Used for relationshipChanges diff. */
  initialRelationships?: Relationship[];
  /** Per-tick snapshots (sorted by tick) used to compute density evolution. */
  snapshotsByTick?: { tick: number; relationships: Relationship[] }[];
  /** Agent descriptors for sociogram nodes and homophily analysis. */
  nodes: AgentNode[];
  /** Community detection strength threshold (default 0.3). */
  communityStrengthThreshold?: number;
}

const DEFAULT_COMMUNITY_THRESHOLD = 0.3;
const EIGEN_ITERATIONS = 30;

/** Aggregates the final graph into a complete NetworkAnalysis. */
export function analyzeNetwork(input: NetworkAnalyzerInput): NetworkAnalysis {
  const { finalRelationships, nodes } = input;
  const threshold = input.communityStrengthThreshold ?? DEFAULT_COMMUNITY_THRESHOLD;

  const nodeIds = nodes.map((n) => n.agentId);
  const idIndex = new Map(nodeIds.map((id, i) => [id, i]));

  const edgesFinal = toEdges(finalRelationships, idIndex);
  const centrality = computeCentrality(nodeIds, edgesFinal);
  const density = computeDensityOverTime(nodeIds.length, input.snapshotsByTick ?? [
    { tick: lastTick(input.snapshotsByTick), relationships: finalRelationships },
  ]);
  const communities = detectCommunities(nodeIds, finalRelationships, threshold);
  const reciprocity = computeReciprocity(finalRelationships);
  const homophily = computeHomophily(nodes, finalRelationships);
  const relationshipChanges = diffRelationships(
    input.initialRelationships ?? [],
    finalRelationships,
  );

  const sociogramFinal = {
    nodes,
    edges: finalRelationships.map<RelationshipSnapshot>((r) => ({
      from: r.from,
      to: r.to,
      type: r.type,
      strength: r.strength,
      tick: r.lastInteraction ?? r.since,
    })),
  };

  return {
    sociogramFinal,
    centrality,
    density,
    communities,
    reciprocity,
    homophily,
    relationshipChanges,
  };
}

function lastTick(snaps?: { tick: number; relationships: Relationship[] }[]): number {
  if (!snaps || snaps.length === 0) return 0;
  return snaps[snaps.length - 1]!.tick;
}

interface Edge {
  from: number;
  to: number;
  weight: number;
}

function toEdges(rels: Relationship[], index: Map<string, number>): Edge[] {
  const edges: Edge[] = [];
  for (const r of rels) {
    const f = index.get(r.from);
    const t = index.get(r.to);
    if (f === undefined || t === undefined) continue;
    if (f === t) continue;
    edges.push({ from: f, to: t, weight: r.strength });
  }
  return edges;
}

/* ------------------------------------------------------------------ */
/*  Centrality                                                         */
/* ------------------------------------------------------------------ */

function computeCentrality(nodeIds: string[], edges: Edge[]): CentralityScore[] {
  const n = nodeIds.length;
  if (n === 0) return [];

  const degree = new Array<number>(n).fill(0);
  const undirectedAdj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const e of edges) {
    degree[e.from]! += 1;
    degree[e.to]! += 1;
    undirectedAdj[e.from]!.add(e.to);
    undirectedAdj[e.to]!.add(e.from);
  }

  const betweenness = brandesBetweenness(n, undirectedAdj);
  const eigenvector = powerIterationEigen(n, undirectedAdj);

  return nodeIds.map((id, i) => ({
    agentId: id,
    degree: degree[i]!,
    betweenness: round4(betweenness[i]!),
    eigenvector: round4(eigenvector[i]!),
  }));
}

/** Brandes algorithm for unweighted betweenness on an undirected graph. */
function brandesBetweenness(n: number, adj: Set<number>[]): number[] {
  const cb = new Array<number>(n).fill(0);
  if (n < 3) return cb;

  for (let s = 0; s < n; s++) {
    const stack: number[] = [];
    const pred: number[][] = Array.from({ length: n }, () => []);
    const sigma = new Array<number>(n).fill(0);
    sigma[s] = 1;
    const dist = new Array<number>(n).fill(-1);
    dist[s] = 0;
    const queue: number[] = [s];
    while (queue.length > 0) {
      const v = queue.shift()!;
      stack.push(v);
      for (const w of adj[v]!) {
        if (dist[w]! < 0) {
          dist[w] = dist[v]! + 1;
          queue.push(w);
        }
        if (dist[w] === dist[v]! + 1) {
          sigma[w] = sigma[w]! + sigma[v]!;
          pred[w]!.push(v);
        }
      }
    }
    const delta = new Array<number>(n).fill(0);
    while (stack.length > 0) {
      const w = stack.pop()!;
      for (const v of pred[w]!) {
        delta[v] = delta[v]! + (sigma[v]! / sigma[w]!) * (1 + delta[w]!);
      }
      if (w !== s) cb[w] = cb[w]! + delta[w]!;
    }
  }
  const denom = ((n - 1) * (n - 2)) / 2;
  if (denom === 0) return cb;
  for (let i = 0; i < n; i++) cb[i] = cb[i]! / 2 / denom;
  return cb;
}

/** Power iteration on the adjacency matrix for eigenvector centrality. */
function powerIterationEigen(n: number, adj: Set<number>[]): number[] {
  if (n === 0) return [];
  let x = new Array<number>(n).fill(1 / Math.sqrt(n));
  for (let it = 0; it < EIGEN_ITERATIONS; it++) {
    const y = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (const j of adj[i]!) y[i] = y[i]! + x[j]!;
    }
    const norm = Math.hypot(...y);
    if (norm === 0) return new Array<number>(n).fill(0);
    x = y.map((v) => v / norm);
  }
  return x;
}

/* ------------------------------------------------------------------ */
/*  Density                                                            */
/* ------------------------------------------------------------------ */

function computeDensityOverTime(
  n: number,
  snaps: { tick: number; relationships: Relationship[] }[],
): DensityPoint[] {
  if (n < 2) return snaps.map((s) => ({ tick: s.tick, value: 0 }));
  const maxEdges = n * (n - 1);
  return snaps.map((s) => {
    const unique = new Set<string>();
    for (const r of s.relationships) {
      if (r.from === r.to) continue;
      unique.add(`${r.from}->${r.to}`);
    }
    return { tick: s.tick, value: round4(unique.size / maxEdges) };
  });
}

/* ------------------------------------------------------------------ */
/*  Communities (connected components on thresholded undirected graph) */
/* ------------------------------------------------------------------ */

function detectCommunities(
  nodeIds: string[],
  rels: Relationship[],
  threshold: number,
): Community[] {
  const n = nodeIds.length;
  const parent = new Array<number>(n).fill(0).map((_, i) => i);
  const idIndex = new Map(nodeIds.map((id, i) => [id, i]));
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  const edgeStrengthByPair = new Map<string, number>();
  for (const r of rels) {
    const a = idIndex.get(r.from);
    const b = idIndex.get(r.to);
    if (a === undefined || b === undefined) continue;
    if (r.strength < threshold) continue;
    union(a, b);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    edgeStrengthByPair.set(key, Math.max(edgeStrengthByPair.get(key) ?? 0, r.strength));
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(i);
  }

  const communities: Community[] = [];
  let idx = 0;
  for (const [, members] of groups) {
    if (members.length < 2) continue;
    let internalStrength = 0;
    let pairs = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = members[i]! < members[j]!
          ? `${members[i]!}|${members[j]!}`
          : `${members[j]!}|${members[i]!}`;
        pairs++;
        internalStrength += edgeStrengthByPair.get(key) ?? 0;
      }
    }
    const cohesion = pairs === 0 ? 0 : internalStrength / pairs;
    communities.push({
      id: `c${idx++}`,
      members: members.map((m) => nodeIds[m]!),
      cohesion: round4(cohesion),
    });
  }
  communities.sort((a, b) => b.cohesion - a.cohesion);
  return communities;
}

/* ------------------------------------------------------------------ */
/*  Reciprocity                                                        */
/* ------------------------------------------------------------------ */

function computeReciprocity(rels: Relationship[]): number {
  const directed = new Set<string>();
  for (const r of rels) directed.add(`${r.from}->${r.to}`);
  if (directed.size === 0) return 0;
  let reciprocal = 0;
  for (const key of directed) {
    const [a, b] = key.split("->");
    if (!a || !b) continue;
    if (directed.has(`${b}->${a}`)) reciprocal++;
  }
  return round4(reciprocal / directed.size);
}

/* ------------------------------------------------------------------ */
/*  Homophily (Newman assortativity for categorical attributes)        */
/* ------------------------------------------------------------------ */

function computeHomophily(nodes: AgentNode[], rels: Relationship[]): HomophilyScore[] {
  const attrFns: { name: string; get: (n: AgentNode) => string | undefined }[] = [
    { name: "personality", get: (n) => n.personality?.[0] },
    { name: "profession", get: (n) => n.profession },
    { name: "role", get: (n) => n.role },
  ];
  const byId = new Map(nodes.map((n) => [n.agentId, n]));
  const result: HomophilyScore[] = [];
  for (const attr of attrFns) {
    const categories = new Map<string, number>();
    for (const n of nodes) {
      const v = attr.get(n);
      if (v) categories.set(v, (categories.get(v) ?? 0) + 1);
    }
    if (categories.size < 2) continue;
    // Build mixing matrix normalized to proportions of edges.
    const catIndex = new Map([...categories.keys()].map((c, i) => [c, i]));
    const size = catIndex.size;
    const mix = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    let totalEdges = 0;
    for (const r of rels) {
      const a = attr.get(byId.get(r.from) ?? ({} as AgentNode));
      const b = attr.get(byId.get(r.to) ?? ({} as AgentNode));
      if (!a || !b) continue;
      const ia = catIndex.get(a)!;
      const ib = catIndex.get(b)!;
      mix[ia]![ib] = mix[ia]![ib]! + 1;
      totalEdges++;
    }
    if (totalEdges === 0) continue;
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) mix[i]![j] = mix[i]![j]! / totalEdges;
    }
    let traceSum = 0;
    let aa = 0;
    for (let i = 0; i < size; i++) {
      traceSum += mix[i]![i]!;
      let rowSum = 0;
      let colSum = 0;
      for (let j = 0; j < size; j++) {
        rowSum += mix[i]![j]!;
        colSum += mix[j]![i]!;
      }
      aa += rowSum * colSum;
    }
    const denom = 1 - aa;
    const assortativity = denom === 0 ? 0 : (traceSum - aa) / denom;
    result.push({ attribute: attr.name, assortativity: round4(assortativity) });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/*  Relationship diff                                                  */
/* ------------------------------------------------------------------ */

function diffRelationships(
  initial: Relationship[],
  final: Relationship[],
): RelationshipChange[] {
  const changes: RelationshipChange[] = [];
  const initialByPair = new Map<string, Relationship>();
  for (const r of initial) initialByPair.set(`${r.from}|${r.to}`, r);
  const finalByPair = new Map<string, Relationship>();
  for (const r of final) finalByPair.set(`${r.from}|${r.to}`, r);

  for (const [pair, fRel] of finalByPair) {
    const iRel = initialByPair.get(pair);
    const tick = fRel.lastInteraction ?? fRel.since;
    if (!iRel) {
      changes.push({ type: "created", from: fRel.from, to: fRel.to, tick, toType: fRel.type });
      continue;
    }
    if (iRel.type !== fRel.type) {
      changes.push({
        type: "type_changed",
        from: fRel.from,
        to: fRel.to,
        tick,
        fromType: iRel.type,
        toType: fRel.type,
      });
    }
    const delta = fRel.strength - iRel.strength;
    if (Math.abs(delta) >= 0.2) {
      changes.push({
        type: delta > 0 ? "strengthened" : "weakened",
        from: fRel.from,
        to: fRel.to,
        tick,
        delta: round4(delta),
      });
    }
  }
  for (const [pair, iRel] of initialByPair) {
    if (!finalByPair.has(pair)) {
      changes.push({
        type: "broken",
        from: iRel.from,
        to: iRel.to,
        tick: iRel.lastInteraction ?? iRel.since,
        fromType: iRel.type,
      });
    }
  }
  changes.sort((a, b) => a.tick - b.tick);
  return changes;
}

function round4(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 10000) / 10000;
}
