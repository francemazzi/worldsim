import { describe, it, expect } from "vitest";
import { AttentionPolicy } from "../../src/perception/AttentionPolicy.js";
import { createStimulusId } from "../../src/perception/StimulusBus.js";
import type { Percept } from "../../src/types/PerceptionTypes.js";
import type { AgentInternalState } from "../../src/types/AgentTypes.js";
import type { NeedsState } from "../../src/types/NeedsTypes.js";

function defaultState(): AgentInternalState {
  return {
    mood: "neutral",
    energy: 100,
    goals: [],
    beliefs: {},
    knowledge: {},
    custom: {},
  };
}

function makePercept(overrides: {
  intensity?: number;
  payload?: unknown;
  fromId?: string;
  tick?: number;
  tags?: string[];
} = {}): Percept {
  const tick = overrides.tick ?? 1;
  const intensity = overrides.intensity ?? 0.7;
  return {
    stimulus: {
      id: createStimulusId(),
      kind: "speech",
      channel: "sound",
      source: { kind: "agent", id: overrides.fromId ?? "alice" },
      tick,
      intensity,
      payload: overrides.payload ?? { text: "hello" },
      ...(overrides.tags ? { metadata: { tags: overrides.tags } } : {}),
    },
    via: "sound",
    distanceKm: 0.01,
    perceivedIntensity: intensity,
    tick,
  };
}

describe("AttentionPolicy", () => {
  const policy = new AttentionPolicy();

  it("ranks by intensity by default", () => {
    const p1 = makePercept({ intensity: 0.2 });
    const p2 = makePercept({ intensity: 0.9 });
    const ranked = policy.rank([p1, p2], {
      agentId: "bob",
      agentState: defaultState(),
      currentTick: 1,
    });
    expect(ranked[0]!.percept).toBe(p2);
  });

  it("filters out percepts below the (distractibility-adjusted) threshold", () => {
    const p1 = makePercept({ intensity: 0.05 });
    const ranked = policy.process([p1], {
      agentId: "bob",
      agentState: defaultState(),
      currentTick: 1,
      config: { threshold: 0.5, distractibility: 0 },
    });
    expect(ranked).toHaveLength(0);
  });

  it("respects the budget cap", () => {
    const ps = Array.from({ length: 10 }, (_, i) =>
      makePercept({ intensity: 0.3 + i * 0.05 }),
    );
    const out = policy.process(ps, {
      agentId: "bob",
      agentState: defaultState(),
      currentTick: 1,
      config: { budget: 3 },
    });
    expect(out).toHaveLength(3);
  });

  it("boosts percepts that match an active need's tags", () => {
    const food = makePercept({ tags: ["food"], fromId: "kitchen" });
    const noise = makePercept({ tags: ["noise"], fromId: "street" });
    const needs: NeedsState = {
      needs: [{ id: "hunger", value: 0.8, activationThreshold: 0.5, tags: ["food"] }],
    };
    const ranked = policy.rank([noise, food], {
      agentId: "bob",
      agentState: defaultState(),
      needs,
      currentTick: 1,
    });
    expect(ranked[0]!.percept).toBe(food);
  });

  it("matches goals by substring", () => {
    const aboutFish = makePercept({ payload: { text: "ho preso tre pesci ieri" } });
    const aboutWeather = makePercept({ payload: { text: "che bel tempo oggi" } });
    const state = defaultState();
    state.goals = ["parlare di pesci"];
    const ranked = policy.rank([aboutWeather, aboutFish], {
      agentId: "bob",
      agentState: state,
      currentTick: 1,
    });
    expect(ranked[0]!.percept).toBe(aboutFish);
  });

  it("relationship boost prioritizes percepts from strong contacts", () => {
    const fromFriend = makePercept({ fromId: "alice", intensity: 0.5 });
    const fromStranger = makePercept({ fromId: "stranger", intensity: 0.5 });
    const ranked = policy.rank([fromStranger, fromFriend], {
      agentId: "bob",
      agentState: defaultState(),
      currentTick: 1,
      relationships: [
        { from: "bob", to: "alice", type: "friend", strength: 0.9, since: 0 },
      ],
      config: { relationshipWeight: 1.5 },
    });
    expect(ranked[0]!.percept).toBe(fromFriend);
  });

  it("novelty: previously-seen stimulus ids score lower", () => {
    const p1 = makePercept({ intensity: 0.5 });
    const p2 = makePercept({ intensity: 0.5 });
    const ranked = policy.rank([p1, p2], {
      agentId: "bob",
      agentState: defaultState(),
      currentTick: 1,
      recentPerceptStimulusIds: [p1.stimulus.id],
    });
    expect(ranked[0]!.percept).toBe(p2);
  });

  it("interest tags lift salience even when intensity is low", () => {
    const interesting = makePercept({ intensity: 0.2, tags: ["philosophy"] });
    const loud = makePercept({ intensity: 0.6, tags: ["sport"] });
    const ranked = policy.rank([loud, interesting], {
      agentId: "bob",
      agentState: defaultState(),
      currentTick: 1,
      config: { interests: ["philosophy"] },
    });
    expect(ranked[0]!.percept).toBe(interesting);
  });
});
