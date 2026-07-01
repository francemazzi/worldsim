/**
 * End-to-end check for the needs decay <-> regen loop:
 *
 *  - perception is enabled and an agent is bootstrapped with a hunger need
 *    that is already active,
 *  - the LLM mock makes the agent emit an `interact` action whose payload
 *    mentions food on every tick,
 *  - the `NeedsSatisfierPlugin` is registered and is expected to lower
 *    hunger after the world ticks.
 *
 * Without the plugin, hunger only grows (decay > 0). The test fails if the
 * loop is broken (no `onAgentAction` invocation, no satisfy applied).
 */
import { describe, it, expect, vi } from "vitest";
import { WorldEngine } from "../../src/engine/WorldEngine.js";
import { NeedsSatisfierPlugin } from "../../src/plugins/built-in/NeedsSatisfierPlugin.js";
import { InMemoryMemoryStore } from "../../src/stores/InMemoryMemoryStore.js";
import { InMemoryGraphStore } from "../../src/stores/InMemoryGraphStore.js";

vi.mock("../../src/llm/OpenAICompatAdapter.js", () => {
  return {
    OpenAICompatAdapter: class {
      async chat() {
        return {
          content: JSON.stringify([
            { actionType: "interact", payload: { content: "Mangio una mela", target: "food" } },
          ]),
          usage: { inputTokens: 5, outputTokens: 5 },
        };
      }
      async chatWithTools() {
        return {
          content: JSON.stringify([
            { actionType: "interact", payload: { content: "Mangio una mela", target: "food" } },
          ]),
          usage: { inputTokens: 5, outputTokens: 5 },
        };
      }
    },
  };
});

describe("Needs feedback loop with NeedsSatisfierPlugin", () => {
  it("hunger drops after the agent acts on food while plugin is active", async () => {
    const engine = new WorldEngine({
      worldId: "needs-cycle-1",
      maxTicks: 3,
      tickIntervalMs: 0,
      llm: {
        baseURL: "https://api.example.com/v1",
        apiKey: "test",
        model: "test",
      },
      memoryStore: new InMemoryMemoryStore(),
      graphStore: new InMemoryGraphStore(),
      interaction: { mode: "perception" },
    });

    engine.addAgent({
      id: "alice",
      role: "person",
      name: "Alice",
      profile: {
        name: "Alice",
        personality: ["affamata"],
        goals: [],
        location: { current: { latitude: 45.0, longitude: 9.0 } },
      },
      needs: {
        needs: [
          {
            id: "hunger",
            label: "fame",
            value: 0.8,
            decayPerTick: 0.005,
            activationThreshold: 0.5,
            criticalThreshold: 0.9,
            tags: ["food"],
          },
        ],
      },
    });

    await engine.start();

    const hunger = engine.getNeedsTracker().get("alice")!.needs.find((n) => n.id === "hunger")!;
    expect(hunger.value).toBeLessThan(0.8);
  });

  it("hunger keeps growing without the plugin", async () => {
    const engine = new WorldEngine({
      worldId: "needs-cycle-2",
      maxTicks: 3,
      tickIntervalMs: 0,
      llm: {
        baseURL: "https://api.example.com/v1",
        apiKey: "test",
        model: "test",
      },
      memoryStore: new InMemoryMemoryStore(),
      graphStore: new InMemoryGraphStore(),
      interaction: { mode: "perception", autoNeedsSatisfier: false },
    });

    engine.addAgent({
      id: "bob",
      role: "person",
      name: "Bob",
      profile: {
        name: "Bob",
        personality: ["paziente"],
        goals: [],
        location: { current: { latitude: 45.0, longitude: 9.0 } },
      },
      needs: {
        needs: [
          {
            id: "hunger",
            label: "fame",
            value: 0.5,
            decayPerTick: 0.05,
          },
        ],
      },
    });

    await engine.start();

    const hunger = engine.getNeedsTracker().get("bob")!.needs.find((n) => n.id === "hunger")!;
    expect(hunger.value).toBeGreaterThanOrEqual(0.5);
  });
});
