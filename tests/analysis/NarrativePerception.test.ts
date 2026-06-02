import { describe, it, expect } from "vitest";
import {
  computePerceptionInsights,
  generateNarrative,
} from "../../src/analysis/narrative.js";
import type {
  AgentReport,
  PerceptionMetrics,
  SimulationReport,
} from "../../src/types/ReportTypes.js";
import type { AgentAction } from "../../src/types/AgentTypes.js";

function emptyAgent(id: string, perceive = 0, speak = 0): AgentReport {
  return {
    agentId: id,
    name: id,
    role: "person",
    personality: [],
    actions: { speak, observe: 0, interact: 0, tool_call: 0, finish: 0, perceive },
    totalActions: speak + perceive,
    moodTrajectory: [],
    energyTrajectory: [],
    statusChanges: [],
  };
}

function emptySpeak(agentId: string, tick: number, topicId?: string): AgentAction {
  return {
    agentId,
    tick,
    actionType: "speak",
    payload: { content: `${agentId} parla al tick ${tick}` },
    ...(topicId ? { metadata: { topicId } as never } : {}),
  };
}

function emptyMetrics(perception?: PerceptionMetrics): SimulationReport["metrics"] {
  return {
    totalInteractions: 0,
    totalSpeaks: 0,
    totalObservations: 0,
    totalToolCalls: 0,
    ruleViolations: 0,
    statusChanges: 0,
    totalTokens: 0,
    avgLatencyMs: 0,
    estimatedCost: { amount: 0, currency: "USD" },
    averageMoodByTick: [],
    averageEnergyByTick: [],
    ...(perception ? { perception } : {}),
  };
}

function makeReport(
  perception: PerceptionMetrics,
  agents: AgentReport[],
  rawActions: AgentAction[],
): SimulationReport {
  return {
    summary: {
      worldId: "test-world",
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 1000,
      totalTicks: 5,
      agentCount: agents.length,
      totalActions: rawActions.length,
    } as never,
    timeline: [],
    agents,
    relationships: [],
    metrics: emptyMetrics(perception),
    rawActions,
  };
}

describe("computePerceptionInsights", () => {
  it("returns undefined when the report has no perception metrics", () => {
    const report: SimulationReport = {
      summary: {} as never,
      timeline: [],
      agents: [],
      relationships: [],
      metrics: emptyMetrics(),
      rawActions: [],
    };
    expect(computePerceptionInsights(report)).toBeUndefined();
  });

  it("derives dominantTopics from the metrics.topics block", () => {
    const perception: PerceptionMetrics = {
      totalStimuli: 12,
      stimuliByKind: { speech: 12 },
      stimuliByChannel: { sound: 12 },
      totalTopics: 2,
      avgStimuliPerTopic: 6,
      causalCoherence: 0.8,
      replyRate: 0.5,
      avgParticipantsPerTopic: 2,
      topics: [
        { id: "topic-1", stimuliCount: 7, participants: ["alice", "bob"] },
        { id: "topic-2", stimuliCount: 3, participants: ["alice"] },
      ],
    };
    const report = makeReport(perception, [
      emptyAgent("alice", 4, 3),
      emptyAgent("bob", 1, 2),
    ], []);

    const insights = computePerceptionInsights(report)!;
    expect(insights.dominantTopics).toHaveLength(2);
    expect(insights.dominantTopics[0]!.id).toBe("topic-1");
    expect(insights.dominantTopics[0]!.participants).toEqual(["alice", "bob"]);
  });

  it("falls back to rawActions metadata when topics are missing", () => {
    const perception: PerceptionMetrics = {
      totalStimuli: 4,
      stimuliByKind: { speech: 4 },
      stimuliByChannel: { sound: 4 },
      totalTopics: 1,
      avgStimuliPerTopic: 4,
      causalCoherence: 0.6,
      replyRate: 0.3,
      avgParticipantsPerTopic: 2,
    };
    const report = makeReport(
      perception,
      [emptyAgent("alice", 2, 2), emptyAgent("bob", 0, 2)],
      [
        emptySpeak("alice", 0, "topic-x"),
        emptySpeak("bob", 0, "topic-x"),
        emptySpeak("alice", 1, "topic-x"),
        emptySpeak("bob", 1),
      ],
    );

    const insights = computePerceptionInsights(report)!;
    expect(insights.dominantTopics.length).toBeGreaterThan(0);
    const topX = insights.dominantTopics.find((t) => t.id === "topic-x");
    expect(topX).toBeTruthy();
    expect(topX!.stimuliCount).toBe(3);
    expect(topX!.participants.sort()).toEqual(["alice", "bob"]);
  });

  it("computes silenceRatio from perceive vs speak counts", () => {
    const perception: PerceptionMetrics = {
      totalStimuli: 0,
      stimuliByKind: {},
      stimuliByChannel: {},
      totalTopics: 0,
      avgStimuliPerTopic: 0,
      causalCoherence: 0,
      replyRate: 0,
      avgParticipantsPerTopic: 0,
    };
    const report = makeReport(
      perception,
      [emptyAgent("alice", 6, 2), emptyAgent("bob", 4, 8)],
      [],
    );
    const insights = computePerceptionInsights(report)!;
    // perceive=10, speak=10 -> 0.5
    expect(insights.silenceRatio).toBeCloseTo(0.5, 5);
  });
});

describe("generateNarrative — fallback path with perception", () => {
  it("populates perceptionInsights even without an API key", async () => {
    const perception: PerceptionMetrics = {
      totalStimuli: 6,
      stimuliByKind: { speech: 6 },
      stimuliByChannel: { sound: 6 },
      totalTopics: 1,
      avgStimuliPerTopic: 6,
      causalCoherence: 0.8,
      replyRate: 0.6,
      avgParticipantsPerTopic: 2,
      topics: [{ id: "topic-only", stimuliCount: 6, participants: ["a", "b"] }],
    };
    const report = makeReport(
      perception,
      [emptyAgent("a", 3, 5), emptyAgent("b", 1, 1)],
      [emptySpeak("a", 0, "topic-only"), emptySpeak("b", 1, "topic-only")],
    );

    const previousKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const narrative = await generateNarrative(report);
      expect(narrative.perceptionInsights).toBeTruthy();
      expect(narrative.perceptionInsights!.dominantTopics.length).toBeGreaterThan(0);
      expect(narrative.perceptionInsights!.silenceRatio).toBeGreaterThan(0);
    } finally {
      if (previousKey !== undefined) process.env.OPENAI_API_KEY = previousKey;
    }
  });
});
