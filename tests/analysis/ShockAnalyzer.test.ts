import { describe, it, expect } from "vitest";
import { analyzeShock } from "../../src/analysis/ShockAnalyzer.js";
import type { AgentAction } from "../../src/types/AgentTypes.js";
import type { AgentReport } from "../../src/types/ReportTypes.js";

function action(agentId: string, tick: number, actionType: AgentAction["actionType"]): AgentAction {
  return { agentId, tick, actionType, payload: {} };
}

function agent(id: string, ticks: number, moodBefore: string, moodAfter: string, trigger: number): AgentReport {
  const moodTraj: AgentReport["moodTrajectory"] = [];
  const energyTraj: AgentReport["energyTrajectory"] = [];
  for (let t = 1; t <= ticks; t++) {
    moodTraj.push({ tick: t, mood: t < trigger ? moodBefore : moodAfter, energy: 0 });
    energyTraj.push({ tick: t, mood: "", energy: t < trigger ? 80 : 40 });
  }
  return {
    agentId: id,
    name: id.toUpperCase(),
    role: "person",
    personality: [],
    actions: { speak: 0, observe: 0, interact: 0, tool_call: 0, finish: 0 },
    totalActions: 0,
    moodTrajectory: moodTraj,
    energyTrajectory: energyTraj,
    statusChanges: [],
  };
}

describe("analyzeShock", () => {
  it("computes negative energy delta and detects mood change", () => {
    const trigger = 6;
    const total = 10;
    const agents = [agent("a", total, "calmo", "ansioso", trigger), agent("b", total, "calmo", "preoccupato", trigger)];
    const actions: AgentAction[] = [];
    for (let t = 1; t < trigger; t++) {
      actions.push(action("a", t, "speak"));
      actions.push(action("b", t, "speak"));
    }
    for (let t = trigger; t <= total; t++) {
      actions.push(action("a", t, "observe"));
    }

    const res = analyzeShock({
      triggerTick: trigger,
      rawActions: actions,
      agents,
      violationsByTick: new Map([[trigger + 1, 2]]),
      totalTicks: total,
      windowTicks: 3,
    });

    expect(res.triggerTick).toBe(trigger);
    expect(res.windowTicks).toBe(3);
    expect(res.deltas.avgEnergy).toBeLessThan(0);
    expect(res.deltas.moodChanged).toBe(true);
    expect(res.deltas.speakRate).toBeLessThan(0);
    expect(res.post.violationRate).toBeGreaterThan(0);
  });

  it("returns null recovery when energy never recovers", () => {
    const trigger = 4;
    const total = 10;
    const agents = [agent("a", total, "calmo", "triste", trigger)];
    const res = analyzeShock({
      triggerTick: trigger,
      rawActions: [],
      agents,
      violationsByTick: new Map(),
      totalTicks: total,
      windowTicks: 2,
    });
    expect(res.recoveryTicks).toBeNull();
  });
});
