import { describe, it, expect } from "vitest";
import { MultiWorldRegistry } from "../../src/studio/MultiWorldRegistry.js";
import type { SimulationReport } from "../../src/types/ReportTypes.js";

function createEngine(worldId: string, tick = 0): any {
  return {
    getContext: () => ({ worldId, tickCount: tick }),
    getStatus: () => "running",
    getEventLog: () => [],
    getAgentStatuses: () => ({}),
  };
}

function createReport(worldId: string, actions = 10): SimulationReport {
  return {
    summary: {
      worldId,
      totalTicks: 5,
      agentCount: 2,
      totalEvents: 0,
      totalActions: actions,
      durationMs: 1000,
      startedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
    },
    timeline: [],
    agents: [],
    relationships: [],
    metrics: {
      totalInteractions: 0,
      totalSpeaks: 4,
      totalObservations: 2,
      totalToolCalls: 3,
      ruleViolations: 1,
      statusChanges: 0,
      averageMoodByTick: [],
      averageEnergyByTick: [{ tick: 1, avgEnergy: 70 }],
    },
    rawActions: [],
  };
}

describe("MultiWorldRegistry", () => {
  it("registers active worlds and exposes live report", () => {
    const registry = new MultiWorldRegistry();
    registry.registerWorld("italy-milan", createEngine("italy-milan", 2), () => createReport("italy-milan"));

    const live = registry.getLiveReport("italy-milan");
    expect(live?.worldId).toBe("italy-milan");
    expect(live?.report?.summary.totalActions).toBe(10);
  });

  it("keeps stopped runs in history and compares runs", () => {
    const registry = new MultiWorldRegistry();
    const first = registry.registerWorld("italy-milan", createEngine("italy-milan"), () => createReport("italy-milan", 30));
    registry.stopWorld("italy-milan");

    const second = registry.registerWorld("japan-tokyo", createEngine("japan-tokyo"), () => createReport("japan-tokyo", 10));
    registry.stopWorld("japan-tokyo");

    const compare = registry.compareRuns(first.runId, second.runId);
    expect(compare).not.toBeNull();
    expect(compare?.metrics.totalActionsDelta).toBe(20);

    const runs = registry.listRuns();
    expect(runs.length).toBeGreaterThanOrEqual(2);
  });
});
