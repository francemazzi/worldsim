import { describe, it, expect, vi } from "vitest";
import { WorldEngine } from "../../src/engine/WorldEngine.js";
import type { WorldConfig } from "../../src/types/WorldTypes.js";

vi.mock("../../src/llm/OpenAICompatAdapter.js", () => {
  return {
    OpenAICompatAdapter: class {
      async chat() {
        return {
          content: JSON.stringify([{ actionType: "speak", payload: { text: "hello" } }]),
          usage: { inputTokens: 5, outputTokens: 5 },
        };
      }
      async chatWithTools() {
        return {
          content: JSON.stringify([{ actionType: "speak", payload: { text: "hello" } }]),
          usage: { inputTokens: 5, outputTokens: 5 },
        };
      }
    },
  };
});

function makeConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
  return {
    worldId: "perception-world",
    maxTicks: 1,
    tickIntervalMs: 0,
    llm: {
      baseURL: "https://api.example.com/v1",
      apiKey: "test",
      model: "test",
    },
    ...overrides,
  };
}

describe("WorldEngine — perception integration", () => {
  it("instantiates the perception layer when interaction.mode = 'perception'", async () => {
    const engine = new WorldEngine(
      makeConfig({
        interaction: {
          mode: "perception",
          defaultSenses: [{ channel: "sound", radiusKm: 0.05 }],
        },
      }),
    );
    expect(engine.getPerceptionEngine()).toBeTruthy();
    expect(engine.getStimulusBus()).toBeTruthy();
    expect(engine.getTopicTracker()).toBeTruthy();
    expect(engine.getNeedsTracker()).toBeTruthy();
  });

  it("registers agents as perceivers when perception is on", async () => {
    const engine = new WorldEngine(
      makeConfig({
        interaction: {
          mode: "perception",
          defaultSenses: [{ channel: "sound", radiusKm: 0.05 }],
        },
      }),
    );
    engine.addAgent({
      id: "alice",
      role: "person",
      name: "Alice",
    });
    engine.addAgent({
      id: "bob",
      role: "person",
      name: "Bob",
    });

    await engine.start();

    expect(engine.getPerceptionEngine().hasPerceiver("alice")).toBe(true);
    expect(engine.getPerceptionEngine().hasPerceiver("bob")).toBe(true);
  });

  it("emits entity stimuli on tick (smell from a fountain)", async () => {
    const engine = new WorldEngine(
      makeConfig({
        maxTicks: 2,
        interaction: {
          mode: "perception",
          defaultSenses: [{ channel: "smell", radiusKm: 1 }],
        },
      }),
    );

    engine.addAgent({
      id: "passerby",
      role: "person",
      name: "Passerby",
      profile: {
        name: "Passerby",
        personality: ["curious"],
        goals: [],
        location: { current: { latitude: 45.0, longitude: 9.0 } },
      },
    });

    engine.addEntity({
      id: "fountain-1",
      kind: "object",
      subKind: "fountain",
      position: { latitude: 45.0001, longitude: 9.0 },
      emitters: [
        {
          kind: "smell",
          channel: "smell",
          intensity: 0.6,
          rangeKm: 1,
          payload: { smell: "wet stone" },
          everyNTicks: 1,
        },
      ],
    });

    await engine.start();

    const stimulusBus = engine.getStimulusBus();
    const stimuliAny = stimulusBus.getForTick(2);
    const fromFountain = stimuliAny.filter(
      (s) => s.source.kind === "entity" && s.source.id === "fountain-1",
    );
    expect(fromFountain.length).toBeGreaterThan(0);
  });

  it("requirePerception=true with mode!='perception' throws on construct", () => {
    expect(
      () =>
        new WorldEngine(
          makeConfig({
            interaction: {
              requirePerception: true,
            },
          }),
        ),
    ).toThrow();
  });
});
