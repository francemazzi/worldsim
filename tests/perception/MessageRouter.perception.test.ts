import { describe, it, expect } from "vitest";
import { MessageBus } from "../../src/messaging/MessageBus.js";
import { MessageRouter } from "../../src/agents/internal/MessageRouter.js";
import { StimulusBus } from "../../src/perception/StimulusBus.js";
import { PerceptionEngine } from "../../src/perception/PerceptionEngine.js";
import { LocationIndex } from "../../src/location/LocationIndex.js";
import type { AgentAction } from "../../src/types/AgentTypes.js";

function speakAction(agentId: string, tick: number): AgentAction {
  return {
    agentId,
    actionType: "speak",
    payload: { text: "ciao" },
    tick,
  };
}

describe("MessageRouter — perception mode", () => {
  it("delivers speak only to agents whose senses pick it up", async () => {
    const bus = new MessageBus();
    bus.newTick(1);

    const idx = new LocationIndex();
    idx.update("alice", { latitude: 45.0, longitude: 9.0 });
    idx.update("bob", { latitude: 45.0001, longitude: 9.0001 }); // ~14m
    idx.update("dan", { latitude: 46.0, longitude: 9.0 }); // ~111km

    const stimBus = new StimulusBus();
    stimBus.newTick(1);
    const engine = new PerceptionEngine({ locationIndex: idx });
    engine.registerAgent("alice", [{ channel: "sound", radiusKm: 0.05 }]);
    engine.registerAgent("bob", [{ channel: "sound", radiusKm: 0.05 }]);
    engine.registerAgent("dan", [{ channel: "sound", radiusKm: 0.05 }]);

    const router = new MessageRouter(bus, {
      stimulusBus: stimBus,
      perceptionEngine: engine,
    });

    const receipt = await router.publish(
      "alice",
      speakAction("alice", 1),
      1,
      false,
    );

    expect(bus.getMessages("bob", 1)).toHaveLength(1);
    expect(bus.getMessages("dan", 1)).toHaveLength(0);
    expect(stimBus.getForTick(1)).toHaveLength(1);
    expect(receipt.route).toBe("perception");
    expect(receipt.recipients).toEqual(["bob"]);
  });

  it("strict perception mode drops speech when no one perceives", async () => {
    const bus = new MessageBus();
    bus.newTick(1);

    const idx = new LocationIndex();
    idx.update("alice", { latitude: 0, longitude: 0 });
    idx.update("dan", { latitude: 50, longitude: 50 });

    const stimBus = new StimulusBus();
    stimBus.newTick(1);
    const engine = new PerceptionEngine({ locationIndex: idx });
    engine.registerAgent("dan", [{ channel: "sound", radiusKm: 0.05 }]);

    const router = new MessageRouter(bus, {
      stimulusBus: stimBus,
      perceptionEngine: engine,
      perceptionFallbackToLegacy: false,
    });

    const receipt = await router.publish(
      "alice",
      speakAction("alice", 1),
      1,
      false,
    );

    expect(bus.getMessages("dan", 1)).toHaveLength(0);
    expect(stimBus.getForTick(1)).toHaveLength(1);
    expect(receipt).toMatchObject({
      route: "dropped",
      recipients: [],
    });
  });

  it("optionally falls back to legacy cascade when no perceiver is hit", async () => {
    const bus = new MessageBus();
    bus.newTick(1);

    const stimBus = new StimulusBus();
    stimBus.newTick(1);
    const engine = new PerceptionEngine();

    const idx = new LocationIndex();
    idx.update("alice", { latitude: 0, longitude: 0 });
    idx.update("bob", { latitude: 0, longitude: 0 });

    const router = new MessageRouter(bus, {
      stimulusBus: stimBus,
      perceptionEngine: engine,
      perceptionFallbackToLegacy: true,
      locationIndex: idx,
      defaultBroadcastRadius: 1,
    });

    const receipt = await router.publish(
      "alice",
      speakAction("alice", 1),
      1,
      false,
    );

    expect(bus.getMessages("bob", 1).length).toBeGreaterThan(0);
    expect(receipt.route).toBe("proximity");
  });
});
