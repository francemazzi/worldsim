/**
 * Integration test: in perception mode, the LLM prompt is built from the
 * PERCEZIONI section (filtered + ranked) instead of the legacy "voice"
 * bucket. Captures the messages reaching the LLM stub and asserts on
 * their textual contents.
 */
import { describe, it, expect } from "vitest";
import { PersonAgent } from "../../src/agents/PersonAgent.js";
import { MessageBus } from "../../src/messaging/MessageBus.js";
import { StimulusBus, createStimulusId } from "../../src/perception/StimulusBus.js";
import { PerceptionEngine } from "../../src/perception/PerceptionEngine.js";
import { TopicTracker } from "../../src/perception/TopicTracker.js";
import { NeedsTracker } from "../../src/needs/NeedsTracker.js";
import { LocationIndex } from "../../src/location/LocationIndex.js";
import { buildRulesContext } from "../../src/rules/RulesLoader.js";
import type { LLMAdapter, LLMResponse } from "../../src/llm/LLMAdapter.js";
import type { AgentMessage } from "../../src/types/AgentTypes.js";
import type { Stimulus } from "../../src/types/StimulusTypes.js";
import type { WorldContext } from "../../src/types/WorldTypes.js";

class CapturingLLM implements LLMAdapter {
  capturedMessages: AgentMessage[] = [];
  async chat(messages: AgentMessage[]): Promise<LLMResponse> {
    this.capturedMessages = messages;
    return {
      content: JSON.stringify({
        actionType: "perceive",
        content: "ho notato",
        stateUpdate: { mood: "calm", energy: 50 },
      }),
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
  async chatWithTools(messages: AgentMessage[]): Promise<LLMResponse> {
    return this.chat(messages);
  }
}

function makeWorldCtx(tick: number): WorldContext {
  return {
    worldId: "w",
    tickCount: tick,
    startedAt: new Date(),
    metadata: {},
  };
}

describe("PersonAgent prompt — perception mode", () => {
  it("includes the PERCEZIONI section and omits the legacy voice block", async () => {
    const tick = 1;
    const bus = new MessageBus();
    bus.newTick(tick);

    const stimulusBus = new StimulusBus();
    stimulusBus.newTick(tick);

    const idx = new LocationIndex();
    idx.update("alice", { latitude: 45.0, longitude: 9.0 });
    idx.update("bob", { latitude: 45.0001, longitude: 9.0001 });

    const perceptionEngine = new PerceptionEngine({ locationIndex: idx });
    perceptionEngine.registerAgent("alice", [
      { channel: "sound", radiusKm: 0.05 },
      { channel: "language", languages: ["it"] },
    ]);
    perceptionEngine.registerAgent("bob", [
      { channel: "sound", radiusKm: 0.05 },
    ]);

    const topicTracker = new TopicTracker({ windowTicks: 5 });
    const needsTracker = new NeedsTracker();
    needsTracker.init("alice", {
      needs: [
        {
          id: "thirst",
          label: "sete",
          value: 0.8,
          activationThreshold: 0.5,
          criticalThreshold: 0.95,
        },
      ],
    });

    // Bob speaks something near alice. The MessageRouter would normally
    // mirror this as a directed message; we publish the stimulus directly
    // to keep the test self-contained.
    const stim: Stimulus = {
      id: createStimulusId(),
      kind: "speech",
      channel: "sound",
      source: { kind: "agent", id: "bob" },
      tick,
      intensity: 0.9,
      payload: { text: "che bella giornata" },
      metadata: { language: "it" },
    };
    stimulusBus.publish(stim);
    topicTracker.ingest(stim);

    // Mirror the speech to alice's MessageBus inbox the way MessageRouter
    // does in perception mode, so we can also assert that the legacy
    // bucket is NOT used.
    bus.publishToGroup(
      {
        id: "msg-1",
        from: "bob",
        type: "speak",
        content: JSON.stringify({ text: "che bella giornata" }),
        tick,
      },
      ["alice"],
    );

    const llm = new CapturingLLM();

    const alice = new PersonAgent(
      {
        id: "alice",
        role: "person",
        name: "Alice",
        profile: {
          name: "Alice",
          personality: ["curiosa"],
          goals: [],
        },
        alwaysThink: true,
      },
      llm,
      bus,
      {
        stimulusBus,
        perceptionEngine,
        topicTracker,
        needsTracker,
        locationIndex: idx,
      },
    );

    alice.start(0);
    await alice.tick(makeWorldCtx(tick), buildRulesContext([]));

    const allText = llm.capturedMessages.map((m) => m.content).join("\n");
    expect(allText).toContain("--- PERCEZIONI ---");
    expect(allText).toContain("che bella giornata");
    expect(allText).toContain("--- BISOGNI ATTIVI ---");
    expect(allText).toContain("sete");
    // Legacy voice block must NOT appear in perception mode.
    expect(allText).not.toContain("Le seguenti persone hanno parlato");
    // The action union must mention "perceive" so the LLM can choose silence.
    expect(allText).toContain("perceive");
  });

  it("falls back to the legacy voice block when perception is OFF", async () => {
    const tick = 1;
    const bus = new MessageBus();
    bus.newTick(tick);

    bus.publishToGroup(
      {
        id: "msg-leg-1",
        from: "bob",
        type: "speak",
        content: "ciao alice",
        tick,
      },
      ["alice"],
    );

    const llm = new CapturingLLM();

    const alice = new PersonAgent(
      {
        id: "alice",
        role: "person",
        name: "Alice",
        profile: {
          name: "Alice",
          personality: ["curiosa"],
          goals: [],
        },
        alwaysThink: true,
      },
      llm,
      bus,
    );

    alice.start(0);
    await alice.tick(makeWorldCtx(tick), buildRulesContext([]));

    const allText = llm.capturedMessages.map((m) => m.content).join("\n");
    expect(allText).toContain("Le seguenti persone hanno parlato");
    expect(allText).not.toContain("--- PERCEZIONI ---");
  });
});
