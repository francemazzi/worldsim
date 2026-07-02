import { describe, it, expect } from "vitest";
import type { WorldEvent } from "../src/types/WorldTypes.js";
import type { SimulationReport } from "../src/types/ReportTypes.js";
import {
  buildEmergenceChartData,
  buildEmergenceChartSeries,
  extractBlockedActionsByTick,
  toCumulativeSeries,
  type EmergenceRunResult,
} from "./integration/helpers/emergenceStudyHarness.js";

function mockEvent(tick: number, type: string): WorldEvent {
  return {
    type,
    tick,
    payload: {},
    timestamp: new Date(),
  };
}

function mockRunResult(
  condition: EmergenceRunResult["condition"],
  eventLog: WorldEvent[],
  totalTicks = 8,
): EmergenceRunResult {
  const report = {
    summary: {
      worldId: `emergence-micro-${condition}`,
      totalTicks,
      agentCount: 5,
      totalEvents: eventLog.length,
      totalActions: 32,
      durationMs: 1000,
      startedAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
    },
    timeline: [],
    agents: [],
    relationships: [],
    metrics: {
      ruleViolations: 0,
      totalSpeaks: 0,
      totalToolCalls: 0,
      totalObservations: 0,
      totalInteractions: 0,
      averageEnergy: 0,
      averageMoodScore: 0,
    },
    rawActions: [],
  } satisfies SimulationReport;

  return {
    condition,
    report,
    eventLog,
    awiLite: {
      condition,
      modelLabel: condition,
      m1PopulationAlive: 4,
      m2RuleViolations: 0,
      m3GovernanceEvents: { allowed: 0, warned: 0, blocked: 0 },
      m6TotalSpeaks: 0,
      m7RelationshipCount: 0,
      m7NetworkDensity: null,
      totalActions: 32,
      totalTicks,
    },
  };
}

describe("emergenceStudyHarness chart helpers", () => {
  it("extractBlockedActionsByTick counts only blocked actions per tick", () => {
    const eventLog = [
      mockEvent(1, "action:allowed"),
      mockEvent(1, "action:blocked"),
      mockEvent(4, "action:blocked"),
      mockEvent(4, "action:blocked"),
      mockEvent(5, "action:warned"),
      mockEvent(9, "action:blocked"),
    ];

    expect(extractBlockedActionsByTick(eventLog, 8)).toEqual([
      1, 0, 0, 2, 0, 0, 0, 0,
    ]);
  });

  it("toCumulativeSeries builds a running total", () => {
    expect(toCumulativeSeries([1, 0, 2, 1])).toEqual([1, 1, 3, 4]);
  });

  it("buildEmergenceChartSeries returns cumulative points for each tick", () => {
    const result = mockRunResult("homogeneous_a", [
      mockEvent(1, "action:blocked"),
      mockEvent(4, "action:blocked"),
      mockEvent(4, "action:blocked"),
      mockEvent(5, "action:blocked"),
    ]);

    const series = buildEmergenceChartSeries(result, {
      modelA: "model-a",
      modelB: "model-b",
      maxTicks: 8,
      maxConcurrent: 2,
    });

    expect(series.condition).toBe("homogeneous_a");
    expect(series.label).toBe("model-a");
    expect(series.points).toEqual([
      { tick: 1, cumulative: 1 },
      { tick: 2, cumulative: 1 },
      { tick: 3, cumulative: 1 },
      { tick: 4, cumulative: 3 },
      { tick: 5, cumulative: 4 },
      { tick: 6, cumulative: 4 },
      { tick: 7, cumulative: 4 },
      { tick: 8, cumulative: 4 },
    ]);
  });

  it("buildEmergenceChartData assembles meta and all series", () => {
    const results = [
      mockRunResult("homogeneous_a", [mockEvent(4, "action:blocked")]),
      mockRunResult("homogeneous_b", [
        mockEvent(4, "action:blocked"),
        mockEvent(5, "action:blocked"),
      ]),
      mockRunResult("mixed", [mockEvent(5, "action:blocked")]),
    ];

    const data = buildEmergenceChartData(results, {
      models: {
        modelA: "google/gemini-2.5-flash",
        modelB: "anthropic/claude-3-haiku",
        maxTicks: 8,
        maxConcurrent: 2,
      },
      triggerTick: 4,
      generatedAt: "2026-07-02T12:00:00.000Z",
    });

    expect(data.meta).toMatchObject({
      generatedAt: "2026-07-02T12:00:00.000Z",
      modelA: "google/gemini-2.5-flash",
      modelB: "anthropic/claude-3-haiku",
      maxTicks: 8,
      triggerTick: 4,
      metric: "governance_blocks",
    });
    expect(data.series).toHaveLength(3);
    expect(data.series[1]?.points.at(-1)?.cumulative).toBe(2);
  });
});
