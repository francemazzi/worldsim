import { describe, it, expect } from "vitest";
import { analyzeArchetypes } from "../../src/analysis/ArchetypeAnalyzer.js";
import type { AgentAction } from "../../src/types/AgentTypes.js";
import type { AgentReport } from "../../src/types/ReportTypes.js";
import type { Relationship } from "../../src/types/GraphTypes.js";

function makeAgent(
  id: string,
  opts: Partial<AgentReport> & {
    speak?: number;
    observe?: number;
    tool?: number;
    mood?: string;
  },
): AgentReport {
  const speak = opts.speak ?? 0;
  const observe = opts.observe ?? 0;
  const tool = opts.tool ?? 0;
  const total = speak + observe + tool;
  return {
    agentId: id,
    name: id.toUpperCase(),
    role: "person",
    personality: [],
    actions: { speak, observe, interact: 0, tool_call: tool, finish: 0 },
    totalActions: total,
    moodTrajectory: [
      { tick: 1, mood: opts.mood ?? "neutro", energy: 80 },
      { tick: 2, mood: opts.mood ?? "neutro", energy: 70 },
    ],
    energyTrajectory: [
      { tick: 1, mood: "", energy: 80 },
      { tick: 2, mood: "", energy: 70 },
    ],
    statusChanges: opts.statusChanges ?? [],
    ...opts,
  } as AgentReport;
}

describe("analyzeArchetypes", () => {
  it("classifies a heavy tool-using agent with no violations as compliant", () => {
    const agents = [makeAgent("a", { tool: 8, mood: "sereno" })];
    const res = analyzeArchetypes({
      agents,
      rawActions: [],
      graphSnapshotsByTick: [],
      violationsByTick: new Map(),
      totalTicks: 10,
    });
    expect(res.perAgent).toHaveLength(1);
    expect(res.perAgent[0]!.archetype).toBe("compliant");
    expect(res.perAgent[0]!.subScores.compliant).toBeGreaterThan(0.5);
  });

  it("classifies an observer with questions as skeptic", () => {
    const agents = [makeAgent("s", { observe: 6, speak: 4 })];
    const rawActions: AgentAction[] = [
      { agentId: "s", tick: 1, actionType: "speak", payload: { content: "è davvero così?" } },
      { agentId: "s", tick: 2, actionType: "speak", payload: { content: "perché?" } },
      { agentId: "s", tick: 3, actionType: "speak", payload: { content: "come mai?" } },
      { agentId: "s", tick: 4, actionType: "speak", payload: { content: "siamo sicuri?" } },
    ];
    const res = analyzeArchetypes({
      agents,
      rawActions,
      graphSnapshotsByTick: [],
      violationsByTick: new Map(),
      totalTicks: 10,
    });
    expect(res.perAgent[0]!.archetype).toBe("skeptic");
  });

  it("classifies an inactive agent as apathetic", () => {
    const agents = [
      {
        ...makeAgent("z", { speak: 0, observe: 0, tool: 0 }),
        energyTrajectory: [
          { tick: 1, mood: "", energy: 80 },
          { tick: 10, mood: "", energy: 10 },
        ],
      },
    ];
    const res = analyzeArchetypes({
      agents,
      rawActions: [],
      graphSnapshotsByTick: [],
      violationsByTick: new Map(),
      totalTicks: 40,
    });
    expect(res.perAgent[0]!.archetype).toBe("apathetic");
  });

  it("produces mood variance points per tick when agents disagree", () => {
    const agents = [
      makeAgent("a", { mood: "felice" }),
      makeAgent("b", { mood: "triste" }),
    ];
    const rels: Relationship[] = [];
    const res = analyzeArchetypes({
      agents,
      rawActions: [],
      graphSnapshotsByTick: [{ tick: 1, relationships: rels }],
      violationsByTick: new Map(),
      totalTicks: 2,
    });
    expect(res.moodVarianceByTick.length).toBeGreaterThan(0);
    expect(res.moodVarianceByTick[0]!.variance).toBeGreaterThan(0);
  });
});
