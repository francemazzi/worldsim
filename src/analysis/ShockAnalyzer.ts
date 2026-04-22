import type { AgentAction } from "../types/AgentTypes.js";
import type {
  AgentReport,
  PolicyShockAnalysis,
  ShockDeltas,
  ShockWindowStats,
} from "../types/ReportTypes.js";

export interface ShockAnalyzerInput {
  /** Tick at which the policy was triggered. */
  triggerTick: number;
  /** Optional human-readable description of the policy. */
  description?: string | undefined;
  /** Pre/post window size in ticks (default 5). */
  windowTicks?: number;
  /** All agent actions (used to derive action rates). */
  rawActions: AgentAction[];
  /** Per-agent report (used to derive mood/energy per tick). */
  agents: AgentReport[];
  /** Count of rule violations per tick (sparse map). */
  violationsByTick: Map<number, number>;
  /** Total number of ticks in the simulation. */
  totalTicks: number;
}

const DEFAULT_WINDOW = 5;
const RECOVERY_TOLERANCE = 0.1;

export function analyzeShock(input: ShockAnalyzerInput): PolicyShockAnalysis {
  const w = input.windowTicks ?? DEFAULT_WINDOW;
  const preStart = Math.max(1, input.triggerTick - w);
  const preEnd = Math.max(preStart, input.triggerTick - 1);
  const postStart = input.triggerTick;
  const postEnd = Math.min(input.totalTicks, input.triggerTick + w - 1);

  const pre = aggregateWindow(preStart, preEnd, input);
  const post = aggregateWindow(postStart, postEnd, input);

  const deltas: ShockDeltas = {
    avgEnergy: round4(post.avgEnergy - pre.avgEnergy),
    speakRate: round4(post.speakRate - pre.speakRate),
    violationRate: round4(post.violationRate - pre.violationRate),
    toolCallRate: round4(post.toolCallRate - pre.toolCallRate),
    moodChanged: post.avgMood !== pre.avgMood,
  };

  const recoveryTicks = computeRecoveryTicks(
    input.agents,
    input.triggerTick,
    w,
    pre.avgEnergy,
    input.totalTicks,
  );

  const result: PolicyShockAnalysis = {
    triggerTick: input.triggerTick,
    windowTicks: w,
    pre,
    post,
    deltas,
    recoveryTicks,
  };
  if (input.description) result.description = input.description;
  return result;
}

function aggregateWindow(
  start: number,
  end: number,
  input: ShockAnalyzerInput,
): ShockWindowStats {
  const span = Math.max(1, end - start + 1);
  const actionsInWindow = input.rawActions.filter(
    (a) => a.tick >= start && a.tick <= end,
  );
  const speakCount = actionsInWindow.filter((a) => a.actionType === "speak").length;
  const toolCount = actionsInWindow.filter((a) => a.actionType === "tool_call").length;
  let violationCount = 0;
  for (let t = start; t <= end; t++) {
    violationCount += input.violationsByTick.get(t) ?? 0;
  }

  const agentCount = Math.max(1, input.agents.filter((a) => a.role !== "control").length);
  const energies: number[] = [];
  const moodCounts = new Map<string, number>();
  for (const a of input.agents) {
    if (a.role === "control") continue;
    for (const snap of a.energyTrajectory) {
      if (snap.tick >= start && snap.tick <= end) energies.push(snap.energy);
    }
    for (const snap of a.moodTrajectory) {
      if (snap.tick >= start && snap.tick <= end) {
        moodCounts.set(snap.mood, (moodCounts.get(snap.mood) ?? 0) + 1);
      }
    }
  }
  const avgEnergy = energies.length
    ? energies.reduce((a, b) => a + b, 0) / energies.length
    : 0;
  let topMood = "neutral";
  let topCount = 0;
  for (const [m, c] of moodCounts) {
    if (c > topCount) {
      topMood = m;
      topCount = c;
    }
  }

  return {
    avgMood: topMood,
    avgEnergy: round2(avgEnergy),
    speakRate: round4(speakCount / span / agentCount),
    violationRate: round4(violationCount / span),
    toolCallRate: round4(toolCount / span / agentCount),
  };
}

function computeRecoveryTicks(
  agents: AgentReport[],
  triggerTick: number,
  windowTicks: number,
  preEnergy: number,
  totalTicks: number,
): number | null {
  if (preEnergy === 0) return null;
  const tolerance = preEnergy * RECOVERY_TOLERANCE;
  const firstAfter = triggerTick + windowTicks;
  for (let t = firstAfter; t <= totalTicks; t++) {
    const energies: number[] = [];
    for (const a of agents) {
      if (a.role === "control") continue;
      const snap = a.energyTrajectory.find((s) => s.tick === t);
      if (snap) energies.push(snap.energy);
    }
    if (energies.length === 0) continue;
    const avg = energies.reduce((a, b) => a + b, 0) / energies.length;
    if (Math.abs(avg - preEnergy) <= tolerance) return t - triggerTick;
  }
  return null;
}

function round2(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function round4(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 10000) / 10000;
}
