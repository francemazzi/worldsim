import { describe, expect, it } from "vitest";
import { PluginRegistry } from "../../src/plugins/PluginRegistry.js";
import type { NeedsState } from "../../src/types/NeedsTypes.js";
import type { Percept } from "../../src/types/PerceptionTypes.js";
import type { Stimulus } from "../../src/types/StimulusTypes.js";
import type { WorldContext } from "../../src/types/WorldTypes.js";

function ctx(): WorldContext {
  return {
    worldId: "hooks",
    tickCount: 1,
    startedAt: new Date(),
    metadata: {},
  };
}

function stimulus(): Stimulus {
  return {
    id: "stim-1",
    kind: "speech",
    channel: "sound",
    source: { kind: "agent", id: "alice" },
    tick: 1,
    intensity: 0.7,
    payload: { text: "hello" },
  };
}

describe("PluginRegistry perception hooks", () => {
  it("transforms stimuli and isolates hook failures", async () => {
    const registry = new PluginRegistry();
    registry.register({
      name: "bad-stimulus-plugin",
      version: "1",
      async onStimulusEmit() {
        throw new Error("boom");
      },
    });
    registry.register({
      name: "quiet-stimulus-plugin",
      version: "1",
      async onStimulusEmit(stim) {
        return { ...stim, intensity: 0.25 };
      },
    });

    const result = await registry.runStimulusEmitHooks(stimulus(), ctx());
    expect(result?.intensity).toBe(0.25);
  });

  it("cancels stimuli and stops later transforms", async () => {
    const registry = new PluginRegistry();
    let laterCalled = false;
    registry.register({
      name: "cancel",
      version: "1",
      async onStimulusEmit() {
        return null;
      },
    });
    registry.register({
      name: "later",
      version: "1",
      async onStimulusEmit(stim) {
        laterCalled = true;
        return stim;
      },
    });

    await expect(registry.runStimulusEmitHooks(stimulus(), ctx())).resolves.toBeNull();
    expect(laterCalled).toBe(false);
  });

  it("filters delivered percepts", async () => {
    const registry = new PluginRegistry();
    registry.register({
      name: "filter-percepts",
      version: "1",
      async onPerceptDelivered(_agentId, percepts) {
        return percepts.filter((p) => p.perceivedIntensity > 0.5);
      },
    });

    const base = stimulus();
    const percepts: Percept[] = [
      {
        stimulus: base,
        via: "sound",
        distanceKm: 0,
        perceivedIntensity: 0.4,
        tick: 1,
      },
      {
        stimulus: { ...base, id: "stim-2" },
        via: "sound",
        distanceKm: 0,
        perceivedIntensity: 0.9,
        tick: 1,
      },
    ];

    const result = await registry.runPerceptDeliveredHooks("alice", percepts, ctx());
    expect(result.map((p) => p.stimulus.id)).toEqual(["stim-2"]);
  });

  it("transforms needs state", async () => {
    const registry = new PluginRegistry();
    registry.register({
      name: "rain-makes-tired",
      version: "1",
      async onNeedsTick(_agentId, needs) {
        return {
          needs: needs.needs.map((need) =>
            need.id === "fatigue"
              ? { ...need, value: Math.min(1, need.value + 0.2) }
              : need,
          ),
        };
      },
    });

    const needs: NeedsState = {
      needs: [{ id: "fatigue", value: 0.3 }],
    };
    const result = await registry.runNeedsTickHooks("alice", needs, ctx());
    expect(result.needs[0]?.value).toBe(0.5);
  });
});
