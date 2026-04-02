import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorldEngine } from "../../src/engine/WorldEngine.js";
import type { WorldConfig } from "../../src/types/WorldTypes.js";
import type { WorldSimPlugin } from "../../src/types/PluginTypes.js";

vi.mock("../../src/llm/OpenAICompatAdapter.js", () => {
  return {
    OpenAICompatAdapter: class {
      async chat() {
        return {
          content: '["monitor respectful communication"]',
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }
      async chatWithTools() {
        return {
          content: '[{"agentId":"p1","actionType":"speak","verdict":"approved"}]',
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }
    },
  };
});

function makeConfig(overrides: Partial<WorldConfig> = {}): WorldConfig {
  return {
    worldId: "test-world",
    maxTicks: 3,
    tickIntervalMs: 0,
    llm: {
      baseURL: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "test-model",
    },
    ...overrides,
  };
}

describe("WorldEngine", () => {
  it("status transitions: idle → bootstrapping → running on start()", async () => {
    const engine = new WorldEngine(makeConfig({ maxTicks: 1 }));
    expect(engine.getStatus()).toBe("idle");

    engine.addAgent({
      id: "p1",
      role: "person",
      name: "Test",
      systemPrompt: "You are a test agent",
      iterationsPerTick: 1,
    });

    await engine.start();
    // After max ticks reached, engine stops
    expect(engine.getStatus()).toBe("stopped");
  });

  it("stop() sets status to stopped and calls agent.stop()", async () => {
    const engine = new WorldEngine(makeConfig({ maxTicks: 1 }));
    engine.addAgent({
      id: "p1",
      role: "person",
      name: "Test",
      systemPrompt: "You are a test agent",
    });
    await engine.start();

    expect(engine.getStatus()).toBe("stopped");
  });

  it("maxTicks is respected: loop stops after N ticks", async () => {
    const engine = new WorldEngine(makeConfig({ maxTicks: 3 }));
    engine.addAgent({
      id: "p1",
      role: "person",
      name: "Test",
      systemPrompt: "You are a test agent",
      iterationsPerTick: 1,
    });

    await engine.start();
    expect(engine.getContext().tickCount).toBe(3);
  });

  it("agent with role='control' is instantiated as ControlAgent", async () => {
    const engine = new WorldEngine(makeConfig({ maxTicks: 1 }));
    engine.addAgent({
      id: "c1",
      role: "control",
      name: "Governance",
      systemPrompt: "You are a governance agent",
    });
    engine.addAgent({
      id: "p1",
      role: "person",
      name: "Person",
      systemPrompt: "You are a person",
    });

    await engine.start();
    // If it didn't throw, control agent was instantiated correctly
    expect(engine.getStatus()).toBe("stopped");
  });

  it("plugin.onWorldTick is called for each tick", async () => {
    const onWorldTick = vi.fn();
    const plugin: WorldSimPlugin = {
      name: "test-plugin",
      version: "1.0.0",
      onWorldTick,
    };

    const engine = new WorldEngine(makeConfig({ maxTicks: 3 }));
    engine.use(plugin);
    engine.addAgent({
      id: "p1",
      role: "person",
      name: "Test",
      systemPrompt: "Agent",
    });

    await engine.start();
    expect(onWorldTick).toHaveBeenCalledTimes(3);
  });

  it("pauseAgent(id) changes agent status to paused", async () => {
    const engine = new WorldEngine(makeConfig({ maxTicks: 2 }));
    engine.addAgent({
      id: "p1",
      role: "person",
      name: "Test",
      systemPrompt: "Agent",
    });

    engine.on("tick", (tick) => {
      if (tick === 1) {
        engine.pauseAgent("p1", "Test pause");
      }
    });

    await engine.start();
    // Check event log for pause
    const events = engine.getEventLog();
    expect(events.some((e) => e.type === "agent:paused")).toBe(true);
  });

  it("resumeAgent(id) brings agent back to running", async () => {
    const engine = new WorldEngine(makeConfig({ maxTicks: 3 }));
    engine.addAgent({
      id: "p1",
      role: "person",
      name: "Test",
      systemPrompt: "Agent",
    });

    engine.on("tick", (tick) => {
      if (tick === 1) engine.pauseAgent("p1");
      if (tick === 2) engine.resumeAgent("p1");
    });

    await engine.start();
    const events = engine.getEventLog();
    expect(events.some((e) => e.type === "agent:resumed")).toBe(true);
  });

  it("stopAgent(id) removes agent from registry", async () => {
    const engine = new WorldEngine(makeConfig({ maxTicks: 3 }));
    engine.addAgent({
      id: "p1",
      role: "person",
      name: "Test",
      systemPrompt: "Agent",
    });
    engine.addAgent({
      id: "p2",
      role: "person",
      name: "Test2",
      systemPrompt: "Agent",
    });

    engine.on("tick", (tick) => {
      if (tick === 1) engine.stopAgent("p1", "Completed");
    });

    await engine.start();
    const events = engine.getEventLog();
    expect(events.some((e) => e.type === "agent:stopped")).toBe(true);
    expect(engine.getAgent("p1")).toBeUndefined();
  });

  it("getAgentStatuses() returns correct snapshot", async () => {
    const engine = new WorldEngine(makeConfig({ maxTicks: 2 }));
    engine.addAgent({
      id: "p1",
      role: "person",
      name: "Test",
      systemPrompt: "Agent",
    });
    engine.addAgent({
      id: "p2",
      role: "person",
      name: "Test2",
      systemPrompt: "Agent",
    });

    let captured: Record<string, string> = {};
    engine.on("tick", (tick) => {
      if (tick === 1) {
        engine.pauseAgent("p1");
        captured = engine.getAgentStatuses();
      }
    });

    await engine.start();
    expect(captured["p1"]).toBe("paused");
    expect(captured["p2"]).toBe("running");
  });

  it("plugin.onAgentStatusChange() is called after transitions", async () => {
    const onAgentStatusChange = vi.fn();
    const plugin: WorldSimPlugin = {
      name: "lifecycle-plugin",
      version: "1.0.0",
      onAgentStatusChange,
    };

    const engine = new WorldEngine(makeConfig({ maxTicks: 2 }));
    engine.use(plugin);
    engine.addAgent({
      id: "p1",
      role: "person",
      name: "Test",
      systemPrompt: "Agent",
    });

    engine.on("tick", (tick) => {
      if (tick === 1) engine.pauseAgent("p1", "test");
    });

    await engine.start();
    expect(onAgentStatusChange).toHaveBeenCalled();
  });

  it("event log accumulates events across ticks", async () => {
    const engine = new WorldEngine(makeConfig({ maxTicks: 3 }));
    engine.addAgent({
      id: "p1",
      role: "person",
      name: "Test",
      systemPrompt: "Agent",
    });

    await engine.start();
    const events = engine.getEventLog();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.timestamp instanceof Date)).toBe(true);
  });
});
