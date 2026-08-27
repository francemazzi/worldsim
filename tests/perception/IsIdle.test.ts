import { describe, it, expect } from "vitest";
import { MessageBus } from "../../src/messaging/MessageBus.js";
import { TickContextLoader } from "../../src/agents/internal/TickContextLoader.js";
import { StimulusBus } from "../../src/perception/StimulusBus.js";
import { PerceptionEngine } from "../../src/perception/PerceptionEngine.js";
import { NeedsTracker } from "../../src/needs/NeedsTracker.js";
import type { AgentInternalState } from "../../src/types/AgentTypes.js";
import type { Stimulus } from "../../src/types/StimulusTypes.js";
import { createStimulusId } from "../../src/perception/StimulusBus.js";

function tiredState(): AgentInternalState {
  return {
    mood: "neutral",
    energy: 10,
    goals: [],
    beliefs: {},
    knowledge: {},
    custom: {},
  };
}

describe("TickContextLoader.isIdle — perception integration", () => {
  it("returns true when there is nothing to react to", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const loader = new TickContextLoader("alice", bus, {});
    expect(loader.isIdle(1, tiredState())).toBe(true);
  });

  it("wakes the agent up when a salient percept reaches their senses", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const stimBus = new StimulusBus();
    stimBus.newTick(1);

    const engine = new PerceptionEngine();
    engine.registerAgent("alice", [{ channel: "signal" }]);

    const stim: Stimulus = {
      id: createStimulusId(),
      kind: "signal",
      channel: "signal",
      source: { kind: "world", id: "world" },
      tick: 1,
      intensity: 0.9,
      payload: { text: "alarm" },
    };
    stimBus.publish(stim);

    const loader = new TickContextLoader("alice", bus, {
      perceptionEngine: engine,
      stimulusBus: stimBus,
    });

    expect(loader.isIdle(1, tiredState())).toBe(false);
  });

  it("ignores percepts below the perception floor", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const stimBus = new StimulusBus();
    stimBus.newTick(1);

    const engine = new PerceptionEngine();
    engine.registerAgent("alice", [{ channel: "signal" }]);

    const stim: Stimulus = {
      id: createStimulusId(),
      kind: "signal",
      channel: "signal",
      source: { kind: "world", id: "world" },
      tick: 1,
      intensity: 0.05,
      payload: {},
    };
    stimBus.publish(stim);

    const loader = new TickContextLoader("alice", bus, {
      perceptionEngine: engine,
      stimulusBus: stimBus,
      perceptionFloor: 0.5,
    });

    expect(loader.isIdle(1, tiredState())).toBe(true);
  });

  it("wakes the agent up when a critical need is firing", () => {
    const bus = new MessageBus();
    bus.newTick(1);

    const needs = new NeedsTracker();
    needs.init("alice", {
      needs: [
        {
          id: "thirst",
          value: 0.95,
          activationThreshold: 0.5,
          criticalThreshold: 0.9,
        },
      ],
    });

    const loader = new TickContextLoader("alice", bus, {
      needsTracker: needs,
    });

    expect(loader.isIdle(1, tiredState())).toBe(false);
  });

  it("is not idle when needs are active but not yet critical", () => {
    const bus = new MessageBus();
    bus.newTick(1);

    const needs = new NeedsTracker();
    needs.init("alice", {
      needs: [
        {
          id: "thirst",
          value: 0.6,
          activationThreshold: 0.5,
          criticalThreshold: 0.9,
        },
      ],
    });

    const loader = new TickContextLoader("alice", bus, {
      needsTracker: needs,
    });

    expect(loader.isIdle(1, tiredState())).toBe(false);
  });
});
