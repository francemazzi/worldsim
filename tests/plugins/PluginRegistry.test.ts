import { describe, it, expect, vi } from "vitest";
import { PluginRegistry } from "../../src/plugins/PluginRegistry.js";
import type { WorldSimPlugin } from "../../src/types/PluginTypes.js";

function makePlugin(name: string, overrides: Partial<WorldSimPlugin> = {}): WorldSimPlugin {
  return { name, version: "1.0.0", ...overrides };
}

describe("PluginRegistry", () => {
  it("rejects duplicate plugins (same name)", () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin("my-plugin"));
    expect(() => reg.register(makePlugin("my-plugin"))).toThrow(
      'Plugin "my-plugin" is already registered',
    );
  });

  it("getAllTools() aggregates tools from all plugins", () => {
    const reg = new PluginRegistry();
    reg.register(
      makePlugin("p1", {
        tools: [
          { name: "tool-a", description: "A", inputSchema: {}, execute: vi.fn() },
        ],
      }),
    );
    reg.register(
      makePlugin("p2", {
        tools: [
          { name: "tool-b", description: "B", inputSchema: {}, execute: vi.fn() },
          { name: "tool-c", description: "C", inputSchema: {}, execute: vi.fn() },
        ],
      }),
    );

    const tools = reg.getAllTools();
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(["tool-a", "tool-b", "tool-c"]);
  });

  it("runHook('onAgentStatusChange') does not throw if hook not implemented", async () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin("bare-plugin"));

    await expect(
      reg.runHook(
        "onAgentStatusChange",
        { type: "agent:start", agentId: "a1", requestedBy: "host", tick: 0 },
        "idle",
        "running",
      ),
    ).resolves.toBeUndefined();
  });

  it("runHook() on unimplemented hook does not throw", async () => {
    const reg = new PluginRegistry();
    reg.register(makePlugin("empty"));

    await expect(
      reg.runHook("onWorldTick", 1, {
        worldId: "w1",
        tickCount: 1,
        startedAt: new Date(),
        metadata: {},
      }),
    ).resolves.toBeUndefined();
  });

  it("runHook() isolates errors from sequential plugins", async () => {
    const reg = new PluginRegistry();
    const calls: string[] = [];

    reg.register(
      makePlugin("bad-plugin", {
        onWorldTick: async () => {
          throw new Error("plugin crash");
        },
      }),
    );
    reg.register(
      makePlugin("good-plugin", {
        onWorldTick: async () => {
          calls.push("good");
        },
      }),
    );

    const ctx = { worldId: "w1", tickCount: 1, startedAt: new Date(), metadata: {} };
    await expect(reg.runHook("onWorldTick", 1, ctx)).resolves.toBeUndefined();
    expect(calls).toEqual(["good"]);
  });

  it("runHook() isolates errors from parallel plugins", async () => {
    const reg = new PluginRegistry();
    const calls: string[] = [];

    reg.register(
      makePlugin("bad-parallel", {
        parallel: true,
        onWorldTick: async () => {
          throw new Error("parallel crash");
        },
      }),
    );
    reg.register(
      makePlugin("good-parallel", {
        parallel: true,
        onWorldTick: async () => {
          calls.push("good-p");
        },
      }),
    );

    const ctx = { worldId: "w1", tickCount: 1, startedAt: new Date(), metadata: {} };
    await expect(reg.runHook("onWorldTick", 1, ctx)).resolves.toBeUndefined();
    expect(calls).toEqual(["good-p"]);
  });

  it("runActionHooks() isolates errors from per-action plugins", async () => {
    const reg = new PluginRegistry();
    const calls: string[] = [];

    reg.register(
      makePlugin("crash-action", {
        onAgentAction: async () => {
          throw new Error("action crash");
        },
      }),
    );
    reg.register(
      makePlugin("ok-action", {
        onAgentAction: async (action) => {
          calls.push(action.agentId);
          return action;
        },
      }),
    );

    const action = { agentId: "a1", actionType: "speak", payload: {}, tick: 1 };
    const buildState = () => ({
      agentId: "a1",
      status: "running" as const,
      currentMessages: [],
      loopCount: 0,
      ephemeralMemory: {},
    });

    await expect(
      reg.runActionHooks([action], {} as any, buildState),
    ).resolves.toBeUndefined();
    expect(calls).toEqual(["a1"]);
  });
});
