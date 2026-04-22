import { describe, it, expect } from "vitest";
import { exportDataset, isExportDataset, listDatasets } from "../../src/analysis/exports.js";
import type { SimulationReport } from "../../src/types/ReportTypes.js";

function baseReport(): SimulationReport {
  return {
    summary: {
      worldId: "w",
      totalTicks: 3,
      agentCount: 2,
      totalEvents: 0,
      totalActions: 2,
      durationMs: 100,
      startedAt: "2024-01-01T00:00:00.000Z",
      stoppedAt: "2024-01-01T00:00:01.000Z",
    },
    timeline: [
      { tick: 1, type: "action", agentId: "a", description: "A acts" },
      { tick: 2, type: "policy_trigger", description: "Policy, with comma" },
    ],
    agents: [
      {
        agentId: "a",
        name: "A",
        role: "person",
        personality: ["curious", "open"],
        actions: { speak: 1, observe: 0, interact: 0, tool_call: 1, finish: 0 },
        totalActions: 2,
        moodTrajectory: [],
        energyTrajectory: [],
        statusChanges: [],
      },
    ],
    relationships: [
      {
        from: "a",
        to: "b",
        type: "ally",
        initialStrength: 0.3,
        finalStrength: 0.7,
        delta: 0.4,
        snapshots: [{ from: "a", to: "b", type: "ally", strength: 0.7, tick: 2 }],
      },
    ],
    metrics: {
      totalInteractions: 0,
      totalSpeaks: 1,
      totalObservations: 0,
      totalToolCalls: 1,
      ruleViolations: 0,
      statusChanges: 0,
      totalTokens: 0,
      avgLatencyMs: 0,
      estimatedCost: { amount: 0, currency: "USD" },
      averageMoodByTick: [],
      averageEnergyByTick: [],
    },
    rawActions: [],
  };
}

describe("exports", () => {
  it("lists all supported datasets and validates them", () => {
    const ds = listDatasets();
    expect(ds).toContain("timeline");
    expect(ds).toContain("agents");
    expect(isExportDataset("timeline")).toBe(true);
    expect(isExportDataset("garbage")).toBe(false);
    expect(isExportDataset(undefined)).toBe(false);
  });

  it("serializes the timeline with quoted cells for commas", () => {
    const csv = exportDataset(baseReport(), "timeline");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("tick,type,agentId,description");
    expect(lines[1]).toBe("1,action,a,A acts");
    expect(lines[2]).toBe('2,policy_trigger,,"Policy, with comma"');
  });

  it("serializes agents with pipe-joined personality", () => {
    const csv = exportDataset(baseReport(), "agents");
    expect(csv).toContain("curious|open");
    expect(csv).toContain("agentId,name,role,personality");
  });

  it("serializes relationships with derived snapshotCount", () => {
    const csv = exportDataset(baseReport(), "relationships");
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("from,to,type,initialStrength,finalStrength,delta,snapshotCount");
    expect(lines[1]).toBe("a,b,ally,0.3,0.7,0.4,1");
  });

  it("returns empty CSV when shock data is missing", () => {
    const csv = exportDataset(baseReport(), "shock");
    expect(csv).toBe("");
  });
});
