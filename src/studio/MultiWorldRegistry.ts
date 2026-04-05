import { randomUUID } from "node:crypto";
import type { WorldEngine } from "../engine/WorldEngine.js";
import type {
  LiveReportResponse,
  ReportCompareResponse,
  SimulationReport,
  StoredRunSummary,
  TopicInsight,
} from "../types/ReportTypes.js";

interface WorldRuntimeState {
  runId: string;
  worldId: string;
  engine: WorldEngine;
  status: "running" | "stopped";
  startedAt: string;
  stoppedAt?: string;
  tick: number;
  reportGetter?: (() => SimulationReport | null) | undefined;
  finalReport?: SimulationReport | undefined;
  topics?: TopicInsight[] | undefined;
  topicsUpdatedAt?: string | undefined;
}

export class MultiWorldRegistry {
  private worlds = new Map<string, WorldRuntimeState>();
  private runsById = new Map<string, WorldRuntimeState>();
  private runOrder: string[] = [];

  registerWorld(
    worldId: string,
    engine: WorldEngine,
    reportGetter?: (() => SimulationReport | null) | undefined,
  ): WorldRuntimeState {
    const now = new Date().toISOString();
    const state: WorldRuntimeState = {
      runId: randomUUID(),
      worldId,
      engine,
      status: "running",
      startedAt: now,
      tick: engine.getContext().tickCount,
      reportGetter,
    };
    this.worlds.set(worldId, state);
    this.runsById.set(state.runId, state);
    this.runOrder.unshift(state.runId);
    return state;
  }

  updateWorldTick(worldId: string, tick: number): void {
    const state = this.worlds.get(worldId);
    if (!state) return;
    state.tick = tick;
  }

  stopWorld(worldId: string): void {
    const state = this.worlds.get(worldId);
    if (!state) return;
    state.status = "stopped";
    state.stoppedAt = new Date().toISOString();
    state.tick = state.engine.getContext().tickCount;
    state.finalReport = state.reportGetter?.() ?? undefined;
    this.worlds.delete(worldId);
  }

  getActiveWorld(worldId?: string): WorldRuntimeState | null {
    if (worldId) return this.worlds.get(worldId) ?? null;
    const first = this.worlds.values().next();
    return first.done ? null : first.value;
  }

  getWorldByRun(runId: string): WorldRuntimeState | null {
    return this.runsById.get(runId) ?? null;
  }

  listWorlds(): Array<{ worldId: string; status: "running" | "stopped" }> {
    const active = [...this.worlds.values()].map((w) => ({
      worldId: w.worldId,
      status: w.status,
    }));
    const historical = this.runOrder
      .map((runId) => this.runsById.get(runId))
      .filter((w): w is WorldRuntimeState => !!w)
      .filter((w) => w.status === "stopped")
      .map((w) => ({ worldId: w.worldId, status: "stopped" as const }));

    const dedup = new Map<string, { worldId: string; status: "running" | "stopped" }>();
    for (const item of [...active, ...historical]) {
      if (!dedup.has(item.worldId) || item.status === "running") {
        dedup.set(item.worldId, item);
      }
    }
    return [...dedup.values()];
  }

  listRuns(worldId?: string): StoredRunSummary[] {
    const runs = this.runOrder
      .map((runId) => this.runsById.get(runId))
      .filter((w): w is WorldRuntimeState => !!w)
      .filter((w) => !worldId || w.worldId === worldId);

    return runs.map((w) => {
      const report = w.finalReport ?? w.reportGetter?.() ?? null;
      return {
        runId: w.runId,
        worldId: w.worldId,
        status: w.status,
        startedAt: w.startedAt,
        stoppedAt: w.stoppedAt,
        tick: w.tick,
        totalActions: report?.summary.totalActions ?? 0,
        totalAgents: report?.summary.agentCount ?? 0,
      };
    });
  }

  getLiveReport(worldId?: string): LiveReportResponse | null {
    const state = this.getActiveWorld(worldId);
    if (!state) return null;
    const report = state.reportGetter?.() ?? null;
    return {
      ready: true,
      worldId: state.worldId,
      runId: state.runId,
      status: state.status,
      tick: state.engine.getContext().tickCount,
      updatedAt: new Date().toISOString(),
      report,
    };
  }

  getRunReport(runId: string): SimulationReport | null {
    const run = this.runsById.get(runId);
    if (!run) return null;
    return run.finalReport ?? run.reportGetter?.() ?? null;
  }

  setRunTopics(runId: string, topics: TopicInsight[]): void {
    const run = this.runsById.get(runId);
    if (!run) return;
    run.topics = topics;
    run.topicsUpdatedAt = new Date().toISOString();
  }

  getRunTopics(runId: string): { topics: TopicInsight[]; updatedAt?: string } | null {
    const run = this.runsById.get(runId);
    if (!run?.topics) return null;
    return run.topicsUpdatedAt
      ? { topics: run.topics, updatedAt: run.topicsUpdatedAt }
      : { topics: run.topics };
  }

  compareRuns(runIdA: string, runIdB: string): ReportCompareResponse | null {
    const a = this.getRunReport(runIdA);
    const b = this.getRunReport(runIdB);
    const runA = this.runsById.get(runIdA);
    const runB = this.runsById.get(runIdB);
    if (!a || !b || !runA || !runB) return null;

    const avgEnergyA = average(
      a.metrics.averageEnergyByTick.map((x) => x.avgEnergy),
    );
    const avgEnergyB = average(
      b.metrics.averageEnergyByTick.map((x) => x.avgEnergy),
    );

    return {
      runIds: [runIdA, runIdB],
      worlds: [runA.worldId, runB.worldId],
      metrics: {
        totalActionsDelta: a.summary.totalActions - b.summary.totalActions,
        totalToolCallsDelta: a.metrics.totalToolCalls - b.metrics.totalToolCalls,
        totalSpeaksDelta: a.metrics.totalSpeaks - b.metrics.totalSpeaks,
        averageEnergyDelta: round(avgEnergyA - avgEnergyB),
        ruleViolationsDelta: a.metrics.ruleViolations - b.metrics.ruleViolations,
      },
    };
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, val) => acc + val, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
