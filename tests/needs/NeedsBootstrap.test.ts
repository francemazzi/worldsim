/**
 * Verifies that the WorldBootstrapper auto-initializes the NeedsTracker
 * from the per-agent `AgentConfig.needs` declaration and from the
 * world-level `interaction.defaultNeedsTemplate`.
 */
import { describe, it, expect, vi } from "vitest";
import { WorldEngine } from "../../src/engine/WorldEngine.js";

vi.mock("../../src/llm/OpenAICompatAdapter.js", () => {
  return {
    OpenAICompatAdapter: class {
      async chat() {
        return {
          content: JSON.stringify({ actionType: "perceive", content: "" }),
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
      async chatWithTools() {
        return {
          content: JSON.stringify({ actionType: "perceive", content: "" }),
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
    },
  };
});

describe("WorldBootstrapper — NeedsTracker init", () => {
  it("initializes needs from AgentConfig.needs when perception is on", async () => {
    const engine = new WorldEngine({
      worldId: "needs-bootstrap-1",
      maxTicks: 0,
      tickIntervalMs: 0,
      llm: {
        baseURL: "https://api.example.com/v1",
        apiKey: "test",
        model: "test",
      },
      interaction: { mode: "perception" },
    });

    engine.addAgent({
      id: "alice",
      role: "person",
      name: "Alice",
      needs: {
        needs: [
          { id: "curiosity", value: 0.4, tags: ["mystery"] },
          { id: "hunger", value: 0.7, activationThreshold: 0.5 },
        ],
      },
    });

    await engine.start();

    const ns = engine.getNeedsTracker().get("alice");
    expect(ns).toBeTruthy();
    expect(ns!.needs).toHaveLength(2);
    expect(ns!.needs.find((n) => n.id === "curiosity")?.value).toBeCloseTo(0.4, 5);
    expect(engine.getNeedsTracker().activeNeeds("alice").map((n) => n.id))
      .toContain("hunger");
  });

  it("falls back to defaultNeedsTemplate for agents without their own needs", async () => {
    const engine = new WorldEngine({
      worldId: "needs-bootstrap-2",
      maxTicks: 0,
      tickIntervalMs: 0,
      llm: {
        baseURL: "https://api.example.com/v1",
        apiKey: "test",
        model: "test",
      },
      interaction: {
        mode: "perception",
        defaultNeedsTemplate: "humanBasic",
      },
    });

    engine.addAgent({
      id: "bob",
      role: "person",
      name: "Bob",
    });

    await engine.start();

    const ns = engine.getNeedsTracker().get("bob");
    expect(ns).toBeTruthy();
    const ids = ns!.needs.map((n) => n.id);
    expect(ids).toContain("hunger");
    expect(ids).toContain("thirst");
    expect(ids).toContain("fatigue");
    expect(ids).toContain("social");
  });

  it("does not initialize anything in legacy mode", async () => {
    const engine = new WorldEngine({
      worldId: "needs-bootstrap-3",
      maxTicks: 0,
      tickIntervalMs: 0,
      llm: {
        baseURL: "https://api.example.com/v1",
        apiKey: "test",
        model: "test",
      },
    });

    engine.addAgent({
      id: "carol",
      role: "person",
      name: "Carol",
      needs: { needs: [{ id: "hunger", value: 0.5 }] },
    });

    await engine.start();

    expect(engine.getNeedsTracker().get("carol")).toBeUndefined();
  });
});
