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
});
