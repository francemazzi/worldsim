import { describe, expect, it } from "vitest";
import { PersonAgent } from "../../src/agents/PersonAgent.js";
import { parseAgentAction } from "../../src/agents/internal/ActionParser.js";
import { buildRulesContext } from "../../src/rules/RulesLoader.js";
import { WorldEngine } from "../../src/engine/WorldEngine.js";
import { MessageBus } from "../../src/messaging/MessageBus.js";
import { StimulusBus, createStimulusId } from "../../src/perception/StimulusBus.js";
import { PerceptionEngine } from "../../src/perception/PerceptionEngine.js";
import { TopicTracker } from "../../src/perception/TopicTracker.js";
import { NeedsTracker } from "../../src/needs/NeedsTracker.js";
import { LocationIndex } from "../../src/location/LocationIndex.js";
import { MovementPlugin } from "../../src/plugins/built-in/MovementPlugin.js";
import { reportGeneratorPlugin } from "../../src/plugins/built-in/ReportGeneratorPlugin.js";
import { MessageRouter } from "../../src/agents/internal/MessageRouter.js";
import { PluginRegistry } from "../../src/plugins/PluginRegistry.js";
import { loadScenario } from "../../src/studio/ScenarioLoader.js";
import type { LLMAdapter, LLMResponse } from "../../src/llm/LLMAdapter.js";
import type { AgentMessage } from "../../src/types/AgentTypes.js";
import type { Stimulus } from "../../src/types/StimulusTypes.js";
import type { WorldContext } from "../../src/types/WorldTypes.js";

class StaticLLM implements LLMAdapter {
  captured: AgentMessage[] = [];

  constructor(private readonly content: string) {}

  async chat(messages: AgentMessage[]): Promise<LLMResponse> {
    this.captured = messages;
    return {
      content: this.content,
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }

  async chatWithTools(messages: AgentMessage[]): Promise<LLMResponse> {
    return this.chat(messages);
  }
}

function worldCtx(tick: number): WorldContext {
  return {
    worldId: "w",
    tickCount: tick,
    startedAt: new Date(),
    metadata: {},
  };
}

function llmConfig() {
  return {
    baseURL: "https://api.example.com/v1",
    apiKey: "test",
    model: "test",
  };
}

describe("Perception optimization plan", () => {
  it("parses perception metadata from LLM actions", () => {
    const parsed = parseAgentAction(JSON.stringify({
      actionType: "speak",
      content: "rispondo",
      metadata: {
        topicId: "topic-1",
        inResponseTo: "stim-1",
        intensity: 0.42,
      },
      stateUpdate: { mood: "focused", energy: 80 },
    }));

    expect(parsed.metadata).toEqual({
      topicId: "topic-1",
      inResponseTo: "stim-1",
      intensity: 0.42,
    });
  });

  it("infers topicId and inResponseTo from the attended percept", async () => {
    const tick = 1;
    const messageBus = new MessageBus();
    messageBus.newTick(tick);
    const stimulusBus = new StimulusBus();
    stimulusBus.newTick(tick);

    const locations = new LocationIndex();
    locations.update("alice", { latitude: 45, longitude: 9 });
    locations.update("bob", { latitude: 45.0001, longitude: 9.0001 });

    const perception = new PerceptionEngine({ locationIndex: locations });
    perception.registerAgent("alice", [
      { channel: "sound", radiusKm: 0.05 },
      { channel: "language", languages: ["it"] },
    ]);
    perception.registerAgent("bob", [
      { channel: "sound", radiusKm: 0.05 },
      { channel: "language", languages: ["it"] },
    ]);

    const topicTracker = new TopicTracker();
    const incoming: Stimulus = {
      id: createStimulusId(),
      kind: "speech",
      channel: "sound",
      source: { kind: "agent", id: "bob" },
      tick,
      intensity: 0.9,
      payload: { text: "hai visto il mercato?" },
      topicId: "market-topic",
      metadata: { language: "it" },
    };
    topicTracker.ingest(incoming);
    stimulusBus.publish(incoming);

    const llm = new StaticLLM(JSON.stringify({
      actionType: "speak",
      content: "Si, vengo a vedere.",
      stateUpdate: { mood: "curious", energy: 80, goals: [] },
    }));

    const alice = new PersonAgent(
      {
        id: "alice",
        role: "person",
        name: "Alice",
        profile: { name: "Alice", personality: ["curiosa"], goals: [] },
        alwaysThink: true,
      },
      llm,
      messageBus,
      {
        stimulusBus,
        perceptionEngine: perception,
        topicTracker,
        needsTracker: new NeedsTracker(),
        locationIndex: locations,
      },
    );
    alice.start(0);

    const actions = await alice.tick(worldCtx(tick), buildRulesContext([]));
    expect(actions[0]?.metadata?.topicId).toBe("market-topic");
    expect(actions[0]?.metadata?.inResponseTo).toBe(incoming.id);

    const response = stimulusBus
      .getForTick(tick)
      .find((s) => s.source.id === "alice");
    expect(response?.topicId).toBe("market-topic");
    expect(response?.causedByStimulusId).toBe(incoming.id);
  });

  it("applies onStimulusEmit in the perception router path", async () => {
    const tick = 1;
    const messageBus = new MessageBus();
    messageBus.newTick(tick);
    const stimulusBus = new StimulusBus();
    stimulusBus.newTick(tick);
    const locations = new LocationIndex();
    locations.update("alice", { latitude: 45, longitude: 9 });
    locations.update("bob", { latitude: 45.0001, longitude: 9.0001 });

    const perception = new PerceptionEngine({ locationIndex: locations });
    perception.registerAgent("alice", [{ channel: "sound", radiusKm: 0.05 }]);
    perception.registerAgent("bob", [{ channel: "sound", radiusKm: 0.05 }]);

    const plugins = new PluginRegistry();
    plugins.register({
      name: "lower-intensity",
      version: "1",
      async onStimulusEmit(stim) {
        return { ...stim, intensity: 0.33 };
      },
    });

    const router = new MessageRouter(messageBus, {
      stimulusBus,
      perceptionEngine: perception,
      topicTracker: new TopicTracker(),
      pluginRegistry: plugins,
      getWorldContext: () => worldCtx(tick),
    });

    await router.publish(
      "alice",
      {
        agentId: "alice",
        actionType: "speak",
        payload: { text: "piano" },
        tick,
      },
      tick,
      false,
    );

    expect(stimulusBus.getForTick(tick)[0]?.intensity).toBe(0.33);
    expect(messageBus.getMessages("bob", tick)).toHaveLength(1);
  });

  it("surfaces perceived entity affordances in the prompt", async () => {
    const tick = 1;
    const messageBus = new MessageBus();
    messageBus.newTick(tick);
    const stimulusBus = new StimulusBus();
    stimulusBus.newTick(tick);
    const locations = new LocationIndex();
    locations.update("alice", { latitude: 45, longitude: 9 });

    const perception = new PerceptionEngine({
      locationIndex: locations,
      resolveEntityPosition: () => ({ latitude: 45, longitude: 9 }),
    });
    perception.registerAgent("alice", [{ channel: "smell", radiusKm: 1 }]);

    const appleStim: Stimulus = {
      id: createStimulusId(),
      kind: "smell",
      channel: "smell",
      source: { kind: "entity", id: "apple-1" },
      tick,
      intensity: 0.8,
      payload: { smell: "apple", tags: ["food"] },
      position: { latitude: 45, longitude: 9 },
    };
    stimulusBus.publish(appleStim);

    const llm = new StaticLLM(JSON.stringify({
      actionType: "perceive",
      content: "sento una mela",
      stateUpdate: { mood: "hungry", energy: 50, goals: [] },
    }));

    const alice = new PersonAgent(
      {
        id: "alice",
        role: "person",
        name: "Alice",
        profile: { name: "Alice", personality: ["affamata"], goals: [] },
        alwaysThink: true,
      },
      llm,
      messageBus,
      {
        stimulusBus,
        perceptionEngine: perception,
        topicTracker: new TopicTracker(),
        needsTracker: new NeedsTracker(),
        affordanceResolver: {
          fromPercepts: () => [
            {
              entity: {
                id: "apple-1",
                kind: "object",
                name: "mela",
                affordances: [{ verb: "eat", description: "mangiare la mela" }],
              },
              affordance: { verb: "eat", description: "mangiare la mela" },
            },
          ],
          forEntityIds: () => [],
          hasAffordance: () => true,
        },
      },
    );
    alice.start(0);
    await alice.tick(worldCtx(tick), buildRulesContext([]));

    const prompt = llm.captured.map((m) => m.content).join("\n");
    expect(prompt).toContain("--- AZIONI DISPONIBILI ---");
    expect(prompt).toContain("eat su mela");
  });

  it("uses ScenarioLoader movement location for perception", async () => {
    const result = loadScenario(
      {
        name: "movement-perception",
        maxTicks: 1,
        tickIntervalMs: 0,
        interaction: {
          mode: "perception",
          defaultSenses: [{ channel: "sound", radiusKm: 0.05 }],
        },
        agents: [
          {
            id: "alice",
            role: "person",
            name: "Alice",
            profile: {
              name: "Alice",
              personality: ["curiosa"],
              goals: [],
              location: { current: { latitude: 45, longitude: 9 } },
            },
          },
          {
            id: "bob",
            role: "person",
            name: "Bob",
            profile: {
              name: "Bob",
              personality: ["calmo"],
              goals: [],
              location: { current: { latitude: 45.01, longitude: 9 } },
            },
          },
        ],
      },
      llmConfig(),
    );

    const engine = result.engine;
    const perception = engine.getPerceptionEngine();
    perception.registerAgent("alice", [{ channel: "sound", radiusKm: 0.05 }]);

    const stimBus = engine.getStimulusBus();
    stimBus.newTick(1);
    const bobSpeech: Stimulus = {
      id: "bob-speech",
      kind: "speech",
      channel: "sound",
      source: { kind: "agent", id: "bob" },
      tick: 1,
      intensity: 1,
      payload: { text: "ciao" },
    };
    stimBus.publish(bobSpeech);
    expect(perception.perceiveFor("alice", stimBus, 1)).toHaveLength(0);

    const movement = engine.getPlugin("movement") as MovementPlugin | undefined;
    const move = movement?.tools.find((tool) => tool.name === "move_to_coordinates");
    expect(move).toBeTruthy();
    await move!.execute(
      { latitude: 45.0101, longitude: 9.0001 },
      { ...worldCtx(1), metadata: { currentAgentId: "alice" } },
    );

    expect(perception.perceiveFor("alice", stimBus, 1)).toHaveLength(1);
  });

  it("fails requirePerception during bootstrap when senses or locations are missing", async () => {
    const noSenses = new WorldEngine({
      worldId: "no-senses",
      maxTicks: 1,
      tickIntervalMs: 0,
      llm: llmConfig(),
      interaction: { mode: "perception", requirePerception: true },
    });
    noSenses.addAgent({
      id: "alice",
      role: "person",
      name: "Alice",
      profile: {
        name: "Alice",
        personality: ["curiosa"],
        goals: [],
        location: { current: { latitude: 45, longitude: 9 } },
      },
    });
    await expect(noSenses.start()).rejects.toThrow("no usable senses");

    const noLocation = new WorldEngine({
      worldId: "no-location",
      maxTicks: 1,
      tickIntervalMs: 0,
      llm: llmConfig(),
      interaction: {
        mode: "perception",
        requirePerception: true,
        defaultSenses: [{ channel: "sound", radiusKm: 0.05 }],
      },
    });
    noLocation.addAgent({
      id: "bob",
      role: "person",
      name: "Bob",
      profile: { name: "Bob", personality: ["calmo"], goals: [] },
    });
    await expect(noLocation.start()).rejects.toThrow("missing profile.location");
  });

  it("reports perception metrics for entity-only worlds without topics", async () => {
    const engine = new WorldEngine({
      worldId: "entity-only",
      maxTicks: 1,
      tickIntervalMs: 0,
      llm: llmConfig(),
      interaction: {
        mode: "perception",
        defaultSenses: [{ channel: "smell", radiusKm: 1 }],
      },
    });
    const report = reportGeneratorPlugin({ engine });
    engine.use(report.plugin);
    engine.addEntity({
      id: "fountain",
      kind: "object",
      position: { latitude: 45, longitude: 9 },
      emitters: [
        {
          kind: "smell",
          channel: "smell",
          intensity: 0.6,
          payload: { smell: "water" },
        },
      ],
    });

    await engine.start();
    const finalReport = report.getReport();
    expect(finalReport?.metrics.perception).toMatchObject({
      totalStimuli: 1,
      totalTopics: 0,
      retainedStimulusTicks: 1,
    });
  });

  it("auto-registers NeedsSatisfierPlugin via ensureNeedsSatisfier in perception mode", () => {
    const result = loadScenario(
      {
        name: "needs-loader",
        maxTicks: 1,
        tickIntervalMs: 0,
        interaction: {
          mode: "perception",
          defaultNeedsTemplate: "humanBasic",
          defaultSenses: [{ channel: "sound", radiusKm: 0.05 }],
        },
        agents: [
          {
            id: "a1",
            role: "person",
            name: "A",
            profile: {
              name: "A",
              personality: ["quiet"],
              goals: ["rest"],
            },
          },
        ],
      },
      llmConfig(),
    );

    result.engine.ensureNeedsSatisfier();
    expect(result.engine.getPlugin("needs-satisfier")).toBeTruthy();
  });
});
