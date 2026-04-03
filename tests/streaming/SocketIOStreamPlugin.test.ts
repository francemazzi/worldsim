import { describe, it, expect, vi, beforeEach } from "vitest";
import { SocketIOStreamPlugin } from "../../src/streaming/SocketIOStreamPlugin.js";
import type { AgentAction, AgentState } from "../../src/types/AgentTypes.js";
import type { WorldContext } from "../../src/types/WorldTypes.js";
import type { RulesContext } from "../../src/types/RulesTypes.js";

function createMockIO() {
  const emitted: Array<{ event: string; data: unknown }> = [];
  const rooms = new Map<string, { emit: ReturnType<typeof vi.fn> }>();

  const io = {
    emit: vi.fn((event: string, data: unknown) => {
      emitted.push({ event, data });
    }),
    to: vi.fn((room: string) => {
      if (!rooms.has(room)) {
        rooms.set(room, { emit: vi.fn() });
      }
      return rooms.get(room)!;
    }),
    _emitted: emitted,
    _rooms: rooms,
  };
  return io;
}

describe("SocketIOStreamPlugin", () => {
  let io: ReturnType<typeof createMockIO>;
  let plugin: SocketIOStreamPlugin;

  beforeEach(() => {
    io = createMockIO();
    plugin = new SocketIOStreamPlugin(io as any);
    plugin.registerAgentName("agent-1", "Alice");
  });

  it("has correct metadata", () => {
    expect(plugin.name).toBe("socket-io-stream");
    expect(plugin.version).toBe("1.0.0");
    expect(plugin.parallel).toBe(true);
  });

  it("emits world:status on bootstrap", async () => {
    const ctx: WorldContext = { worldId: "test", tickCount: 0, startedAt: new Date(), metadata: {} };
    const rules = { getRulesForScope: () => [] } as unknown as RulesContext;

    await plugin.onBootstrap!(ctx, rules);

    expect(io.emit).toHaveBeenCalledWith("world:status", { status: "running" });
  });

  it("emits world:tick on tick", async () => {
    plugin.setAgentCounts(3, 5);
    const ctx: WorldContext = { worldId: "test", tickCount: 1, startedAt: new Date(), metadata: {} };

    await plugin.onWorldTick!(1, ctx);

    const tickCall = io._emitted.find((e) => e.event === "world:tick");
    expect(tickCall).toBeDefined();
    const data = tickCall!.data as any;
    expect(data.tick).toBe(1);
    expect(data.activeAgents).toBe(3);
    expect(data.totalAgents).toBe(5);
  });

  it("emits agent:action globally and to agent room", async () => {
    const action: AgentAction = {
      agentId: "agent-1",
      actionType: "speak",
      payload: { text: "Hello!" },
      tick: 5,
    };
    const state: AgentState = {
      agentId: "agent-1",
      status: "running",
      currentMessages: [],
      loopCount: 1,
      ephemeralMemory: {},
    };

    const result = await plugin.onAgentAction!(action, state);

    // Should return action unchanged
    expect(result).toBe(action);

    // Global emit
    const globalCall = io._emitted.find((e) => e.event === "agent:action");
    expect(globalCall).toBeDefined();
    expect((globalCall!.data as any).agentName).toBe("Alice");
    expect((globalCall!.data as any).action).toBe(action);

    // Room emit
    expect(io.to).toHaveBeenCalledWith("agent:agent-1");
    const room = io._rooms.get("agent:agent-1");
    expect(room?.emit).toHaveBeenCalledWith("agent:action", expect.objectContaining({
      agentId: "agent-1",
      agentName: "Alice",
    }));
  });

  it("emits agent:status on status change", async () => {
    await plugin.onAgentStatusChange!(
      { type: "agent:pause", agentId: "agent-1", requestedBy: "host", tick: 3, reason: "test" },
      "running",
      "paused",
    );

    const statusCall = io._emitted.find((e) => e.event === "agent:status");
    expect(statusCall).toBeDefined();
    const data = statusCall!.data as any;
    expect(data.agentId).toBe("agent-1");
    expect(data.oldStatus).toBe("running");
    expect(data.newStatus).toBe("paused");
    expect(data.agentName).toBe("Alice");
  });

  it("emits world:status stopped on world stop", async () => {
    const ctx: WorldContext = { worldId: "test", tickCount: 10, startedAt: new Date(), metadata: {} };

    await plugin.onWorldStop!(ctx, []);

    expect(io.emit).toHaveBeenCalledWith("world:status", { status: "stopped" });
  });

  it("uses agentId as fallback name for unknown agents", async () => {
    const action: AgentAction = {
      agentId: "unknown-agent",
      actionType: "observe",
      payload: {},
      tick: 1,
    };
    const state: AgentState = {
      agentId: "unknown-agent",
      status: "running",
      currentMessages: [],
      loopCount: 1,
      ephemeralMemory: {},
    };

    await plugin.onAgentAction!(action, state);

    const globalCall = io._emitted.find((e) => e.event === "agent:action");
    expect((globalCall!.data as any).agentName).toBe("unknown-agent");
  });
});
