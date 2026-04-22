import type { AgentAction } from "../types/AgentTypes.js";
import type { Relationship } from "../types/GraphTypes.js";
import type {
  AgentArchetype,
  AgentReport,
  ArchetypeAnalysis,
  ContagionPoint,
  MoodVariancePoint,
  ReactionArchetype,
} from "../types/ReportTypes.js";
import { moodValence } from "./moodValence.js";

export interface ArchetypeAnalyzerInput {
  /** Per-agent report. */
  agents: AgentReport[];
  /** All actions (used to count tool calls, question marks, etc.). */
  rawActions: AgentAction[];
  /** Snapshots of the graph ordered by tick (for neighbor lookup). */
  graphSnapshotsByTick: { tick: number; relationships: Relationship[] }[];
  /** Violations by tick. */
  violationsByTick: Map<number, number>;
  /** Total ticks of the run. */
  totalTicks: number;
  /** Optional trigger tick to contextualize archetypes around a policy event. */
  triggerTick?: number | undefined;
}

const ARCHETYPE_LIST: ReactionArchetype[] = [
  "compliant",
  "skeptic",
  "resistant",
  "apathetic",
];

export function analyzeArchetypes(input: ArchetypeAnalyzerInput): ArchetypeAnalysis {
  const perAgent: AgentArchetype[] = [];
  const agentsToAnalyze = input.agents.filter((a) => a.role !== "control");
  for (const agent of agentsToAnalyze) {
    perAgent.push(scoreAgent(agent, input));
  }
  const emotionalContagion = computeEmotionalContagion(agentsToAnalyze, input.graphSnapshotsByTick);
  const moodVarianceByTick = computeMoodVariance(agentsToAnalyze, input.totalTicks);

  return { perAgent, emotionalContagion, moodVarianceByTick };
}

function scoreAgent(agent: AgentReport, input: ArchetypeAnalyzerInput): AgentArchetype {
  const agentActions = input.rawActions.filter((a) => a.agentId === agent.agentId);
  const totalActions = agent.totalActions || 1;

  // Compliant: many tool calls, no violations, low mood shift after trigger.
  const toolRatio = agent.actions.tool_call / totalActions;
  const violations = countAgentViolations(agent.agentId, input);
  const moodSwing = computeMoodSwing(agent, input.triggerTick);
  const compliant = clamp01(
    0.5 * toolRatio + 0.3 * (violations === 0 ? 1 : 0) + 0.2 * (1 - moodSwing),
  );

  // Skeptic: many observe, question marks in speech content, mood near neutral.
  const observeRatio = agent.actions.observe / totalActions;
  const questionRatio = countQuestions(agentActions) / Math.max(1, agent.actions.speak);
  const neutralMoodRatio = agent.moodTrajectory.filter((s) => Math.abs(moodValence(s.mood)) < 0.2).length
    / Math.max(1, agent.moodTrajectory.length);
  const skeptic = clamp01(
    0.4 * observeRatio + 0.4 * Math.min(questionRatio, 1) + 0.2 * neutralMoodRatio,
  );

  // Resistant: status changes with reason, violations, negative valence drift.
  const statusWithReason = agent.statusChanges.filter((s) => s.reason).length;
  const negDrift = Math.max(0, -moodTrend(agent));
  const resistant = clamp01(
    0.4 * Math.min(1, statusWithReason) + 0.4 * Math.min(1, violations / 3) + 0.2 * negDrift,
  );

  // Apathetic: low activity, decreasing energy, few speaks.
  const activityRatio = Math.min(1, agent.totalActions / Math.max(1, input.totalTicks));
  const energyTrend = computeEnergyTrend(agent);
  const apathetic = clamp01(
    0.5 * (1 - activityRatio) + 0.3 * Math.max(0, -energyTrend) + 0.2 * (agent.actions.speak === 0 ? 1 : 0),
  );

  const subScores: Record<ReactionArchetype, number> = {
    compliant: round4(compliant),
    skeptic: round4(skeptic),
    resistant: round4(resistant),
    apathetic: round4(apathetic),
  };
  let best: ReactionArchetype = ARCHETYPE_LIST[0]!;
  let bestScore = -1;
  for (const k of ARCHETYPE_LIST) {
    if (subScores[k]! > bestScore) {
      best = k;
      bestScore = subScores[k]!;
    }
  }

  const rationale = buildRationale(best, {
    toolRatio,
    violations,
    observeRatio,
    questionRatio,
    statusWithReason,
    activityRatio,
    energyTrend,
    moodSwing,
  });

  return {
    agentId: agent.agentId,
    archetype: best,
    score: round4(bestScore),
    rationale,
    subScores,
  };
}

interface RationaleInputs {
  toolRatio: number;
  violations: number;
  observeRatio: number;
  questionRatio: number;
  statusWithReason: number;
  activityRatio: number;
  energyTrend: number;
  moodSwing: number;
}

function buildRationale(archetype: ReactionArchetype, m: RationaleInputs): string {
  switch (archetype) {
    case "compliant":
      return `${pct(m.toolRatio)} di azioni sono tool_call, ${m.violations} violazioni, swing dell'umore ${m.moodSwing.toFixed(2)}.`;
    case "skeptic":
      return `${pct(m.observeRatio)} di azioni sono observe, ${pct(m.questionRatio)} dei speak contengono domande.`;
    case "resistant":
      return `${m.statusWithReason} status change motivati e ${m.violations} violazioni registrate.`;
    case "apathetic":
      return `Attività pari a ${pct(m.activityRatio)} della durata, trend energia ${m.energyTrend.toFixed(2)}.`;
  }
}

function pct(x: number): string {
  return `${Math.round(clamp01(x) * 100)}%`;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function countAgentViolations(_agentId: string, input: ArchetypeAnalyzerInput): number {
  // Violations are tracked globally by tick; we also use status changes with
  // a reason as a per-agent signal elsewhere. Here we just return the count
  // of status changes that include a reason for this agent, as a proxy.
  const agent = input.agents.find((a) => a.agentId === _agentId);
  if (!agent) return 0;
  return agent.statusChanges.filter((s) => !!s.reason).length;
}

function countQuestions(actions: AgentAction[]): number {
  let n = 0;
  for (const a of actions) {
    if (a.actionType !== "speak") continue;
    const content = extractContent(a.payload);
    if (/\?/.test(content)) n++;
  }
  return n;
}

function extractContent(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    if (typeof rec.content === "string") return rec.content;
  }
  return "";
}

function moodTrend(agent: AgentReport): number {
  if (agent.moodTrajectory.length < 2) return 0;
  const first = moodValence(agent.moodTrajectory[0]!.mood);
  const last = moodValence(agent.moodTrajectory[agent.moodTrajectory.length - 1]!.mood);
  return last - first;
}

function computeEnergyTrend(agent: AgentReport): number {
  if (agent.energyTrajectory.length < 2) return 0;
  const first = agent.energyTrajectory[0]!.energy;
  const last = agent.energyTrajectory[agent.energyTrajectory.length - 1]!.energy;
  return (last - first) / 100;
}

function computeMoodSwing(agent: AgentReport, triggerTick?: number): number {
  if (agent.moodTrajectory.length === 0) return 0;
  if (triggerTick == null) return Math.abs(moodTrend(agent));
  const before = agent.moodTrajectory.find((s) => s.tick <= triggerTick - 1);
  const after = agent.moodTrajectory.find((s) => s.tick >= triggerTick);
  if (!before || !after) return 0;
  return Math.min(1, Math.abs(moodValence(after.mood) - moodValence(before.mood)));
}

function computeEmotionalContagion(
  agents: AgentReport[],
  graphSnapshots: { tick: number; relationships: Relationship[] }[],
): ContagionPoint[] {
  if (agents.length < 2 || graphSnapshots.length === 0) return [];
  const moodByAgentTick = indexMoodValences(agents);
  const snapshotsByTick = new Map<number, Relationship[]>();
  for (const s of graphSnapshots) snapshotsByTick.set(s.tick, s.relationships);

  const ticks = [...new Set(agents.flatMap((a) => a.moodTrajectory.map((s) => s.tick)))].sort(
    (a, b) => a - b,
  );
  const results: ContagionPoint[] = [];
  for (const t of ticks) {
    const pairs: { shift: number; neighborMood: number }[] = [];
    const rels = nearestSnapshot(snapshotsByTick, t, graphSnapshots);
    for (const agent of agents) {
      const vt = moodByAgentTick.get(keyOf(agent.agentId, t));
      const vn = moodByAgentTick.get(keyOf(agent.agentId, t + 1));
      if (vt == null || vn == null) continue;
      const shift = vn - vt;
      const neighbors = rels
        .filter((r) => r.from === agent.agentId || r.to === agent.agentId)
        .map((r) => (r.from === agent.agentId ? r.to : r.from));
      if (neighbors.length === 0) continue;
      const neighborMoods = neighbors
        .map((n) => moodByAgentTick.get(keyOf(n, t)))
        .filter((v): v is number => v != null);
      if (neighborMoods.length === 0) continue;
      const avgNeighbor = neighborMoods.reduce((a, b) => a + b, 0) / neighborMoods.length;
      pairs.push({ shift, neighborMood: avgNeighbor });
    }
    if (pairs.length < 2) continue;
    const corr = pearson(pairs.map((p) => p.neighborMood), pairs.map((p) => p.shift));
    results.push({ tick: t, correlationNeighbors: round4(corr) });
  }
  return results;
}

function nearestSnapshot(
  byTick: Map<number, Relationship[]>,
  tick: number,
  snaps: { tick: number; relationships: Relationship[] }[],
): Relationship[] {
  if (byTick.has(tick)) return byTick.get(tick)!;
  let best: Relationship[] = [];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const s of snaps) {
    const d = Math.abs(s.tick - tick);
    if (d < bestDelta) {
      bestDelta = d;
      best = s.relationships;
    }
  }
  return best;
}

function keyOf(agentId: string, tick: number): string {
  return `${agentId}@${tick}`;
}

function indexMoodValences(agents: AgentReport[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of agents) {
    for (const snap of a.moodTrajectory) {
      out.set(keyOf(a.agentId, snap.tick), moodValence(snap.mood));
    }
  }
  return out;
}

function pearson(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

function computeMoodVariance(agents: AgentReport[], totalTicks: number): MoodVariancePoint[] {
  const out: MoodVariancePoint[] = [];
  for (let t = 1; t <= totalTicks; t++) {
    const values: number[] = [];
    for (const a of agents) {
      const snap = a.moodTrajectory.find((s) => s.tick === t);
      if (snap) values.push(moodValence(snap.mood));
    }
    if (values.length === 0) continue;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
    out.push({ tick: t, variance: round4(variance) });
  }
  return out;
}

function round4(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 10000) / 10000;
}
