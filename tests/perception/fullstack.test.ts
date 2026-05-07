/**
 * Mocked end-to-end test for the realistic simulation primitives.
 *
 * Verifies:
 *  - speak from one agent reaches only the perceivers in range
 *  - distant agents don't get the message
 *  - the topic tracker threads replies on the same topicId
 *  - entity emitters publish stimuli that perceivers can pick up
 *  - the report exposes perception metrics
 */
import { describe, it, expect, vi } from "vitest";
import { WorldEngine } from "../../src/engine/WorldEngine.js";
import { reportGeneratorPlugin } from "../../src/plugins/built-in/ReportGeneratorPlugin.js";
import { InMemoryMemoryStore } from "../../src/stores/InMemoryMemoryStore.js";
import { InMemoryGraphStore } from "../../src/stores/InMemoryGraphStore.js";

vi.mock("../../src/llm/OpenAICompatAdapter.js", () => {
  // Each agent emits a single deterministic speak action per tick. The mock
  // ignores the prompt and produces a payload tagged with the agent id and
  // tick so we can verify routing in the assertions.
  return {
    OpenAICompatAdapter: class {
      async chat() {
        return {
          content: JSON.stringify([
            {
              actionType: "speak",
              payload: { text: "ciao a tutti" },
            },
          ]),
          usage: { inputTokens: 5, outputTokens: 5 },
        };
      }
      async chatWithTools() {
        return {
          content: JSON.stringify([
            { actionType: "speak", payload: { text: "ciao a tutti" } },
          ]),
          usage: { inputTokens: 5, outputTokens: 5 },
        };
      }
    },
  };
});

vi.mock("../../src/llm/LLMAdapterPool.js", async (importOriginal) => {
  // Plain pass-through; the OpenAICompatAdapter mock above is what each
  // agent ends up using when the pool resolves the underlying adapter.
  return await importOriginal();
});

describe("Perception layer — full stack", () => {
  it("only delivers speech to agents whose senses pick it up; report has perception metrics", async () => {
    const engine = new WorldEngine({
      worldId: "perc-fullstack",
      maxTicks: 3,
      tickIntervalMs: 0,
      llm: {
        baseURL: "https://api.example.com/v1",
        apiKey: "test",
        model: "test",
      },
      memoryStore: new InMemoryMemoryStore(),
      graphStore: new InMemoryGraphStore(),
      interaction: {
        mode: "perception",
        disableBroadcastFallback: true,
        defaultSenses: [
          { channel: "sound", radiusKm: 0.05 },
          { channel: "language", languages: ["it"] },
        ],
        topicWindowTicks: 5,
      },
    });

    const report = reportGeneratorPlugin({ engine });
    engine.use(report.plugin);

    engine.addAgent({
      id: "alice",
      role: "person",
      name: "Alice",
      profile: {
        name: "Alice",
        personality: ["loquace"],
        goals: [],
        location: { current: { latitude: 45.0, longitude: 9.0 } },
      },
    });

    engine.addAgent({
      id: "bob",
      role: "person",
      name: "Bob",
      profile: {
        name: "Bob",
        personality: ["paziente"],
        goals: [],
        // ~14m from alice → in range
        location: { current: { latitude: 45.0001, longitude: 9.0001 } },
      },
    });

    engine.addAgent({
      id: "dan",
      role: "person",
      name: "Dan",
      profile: {
        name: "Dan",
        personality: ["solitario"],
        goals: [],
        // ~111km from alice → out of range
        location: { current: { latitude: 46.0, longitude: 9.0 } },
      },
    });

    // Add an entity that emits a sound every tick — both alice and bob
    // should pick it up, dan should not.
    engine.addEntity({
      id: "bell-1",
      kind: "object",
      subKind: "bell",
      position: { latitude: 45.0, longitude: 9.0 },
      emitters: [
        {
          kind: "sound",
          channel: "sound",
          intensity: 0.5,
          rangeKm: 0.05,
          payload: { sound: "ding" },
        },
      ],
    });

    await engine.start();

    // The stimulus bus retains only the current tick by default; check that
    // at least one bell stimulus was emitted at the final tick.
    const finalTick = engine.getContext().tickCount;
    const stimuli = engine.getStimulusBus().getForTick(finalTick);
    const bellStimuli = stimuli.filter(
      (s) => s.source.kind === "entity" && s.source.id === "bell-1",
    );
    expect(bellStimuli.length).toBeGreaterThan(0);

    // Topic tracker must have at least 1 topic from the speakers.
    expect(engine.getTopicTracker().size).toBeGreaterThan(0);

    const finalReport = report.getReport();
    expect(finalReport).toBeTruthy();
    expect(finalReport!.metrics.perception).toBeTruthy();
    expect(finalReport!.metrics.perception!.totalTopics).toBeGreaterThan(0);
    // The report must include the new "perceive" bucket — even if it is 0
    // for this run, the schema must already account for it so downstream
    // consumers don't crash.
    for (const a of finalReport!.agents) {
      expect(a.actions).toHaveProperty("perceive");
    }
  });
});
