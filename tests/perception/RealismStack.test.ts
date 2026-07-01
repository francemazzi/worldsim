import { describe, it, expect, vi } from "vitest";
import { WorldEngine } from "../../src/engine/WorldEngine.js";
import { InMemoryMemoryStore } from "../../src/stores/InMemoryMemoryStore.js";
import { InMemoryGraphStore } from "../../src/stores/InMemoryGraphStore.js";
import { realisticInteractionPreset } from "../../src/interaction/realisticInteractionPreset.js";

vi.mock("../../src/llm/OpenAICompatAdapter.js", () => ({
  OpenAICompatAdapter: class {
    async chat() {
      return {
        content: JSON.stringify({
          actionType: "interact",
          payload: { affordanceVerb: "drink", entityId: "fountain" },
          stateUpdate: { mood: "ok", energy: 80, goals: [] },
        }),
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    }
    async chatWithTools() {
      return this.chat();
    }
  },
}));

describe("Perception realism stack (unit)", () => {
  it("auto-registers NeedsSatisfierPlugin and tracks needs", async () => {
    const engine = new WorldEngine({
      worldId: "realism-unit",
      maxTicks: 2,
      tickIntervalMs: 0,
      llm: { baseURL: "http://x", apiKey: "k", model: "m" },
      memoryStore: new InMemoryMemoryStore(),
      graphStore: new InMemoryGraphStore(),
      interaction: realisticInteractionPreset(),
    });

    engine.addAgent({
      id: "near",
      role: "person",
      name: "Near",
      profile: {
        name: "Near",
        personality: ["quiet"],
        goals: ["rest"],
        location: { current: { latitude: 45.4642, longitude: 9.19, label: "piazza" } },
      },
    });

    engine.addAgent({
      id: "far",
      role: "person",
      name: "Far",
      alwaysThink: true,
      profile: {
        name: "Far",
        personality: ["quiet"],
        goals: [],
        location: { current: { latitude: 45.47, longitude: 9.22, label: "casa" } },
      },
    });

    engine.addEntity({
      id: "fountain",
      kind: "object",
      name: "Fontana",
      position: { latitude: 45.46422, longitude: 9.19002 },
      affordances: [{ verb: "drink", description: "Bere acqua" }],
    });

    await engine.start();

    const tracker = engine.getNeedsTracker();
    const nearThirst = tracker.get("near")?.needs.find((n) => n.id === "thirst");
    expect(nearThirst).toBeDefined();
  });
});
