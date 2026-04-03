import { describe, it, expect, vi, afterEach } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { WorldSimServer } from "../../src/streaming/WorldSimServer.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  WorldSnapshot,
  TickEvent,
  AgentActionEvent,
  AgentStatusEvent,
} from "../../src/streaming/types.js";

/**
 * Mock the LLM so we don't need a real API key.
 */
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

type TypedClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

function waitForEvent<K extends keyof ServerToClientEvents>(
  socket: TypedClientSocket,
  event: K,
  timeoutMs = 5_000,
): Promise<Parameters<ServerToClientEvents[K]>[0]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for "${String(event)}" (${timeoutMs}ms)`)),
      timeoutMs,
    );
    socket.once(event as string, (data: any) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function collectEvents<K extends keyof ServerToClientEvents>(
  socket: TypedClientSocket,
  event: K,
  count: number,
  timeoutMs = 10_000,
): Promise<Parameters<ServerToClientEvents[K]>[0][]> {
  return new Promise((resolve, reject) => {
    const collected: any[] = [];
    const timer = setTimeout(
      () => reject(new Error(`Timeout collecting ${count} "${String(event)}" events (got ${collected.length})`)),
      timeoutMs,
    );
    const handler = (data: any) => {
      collected.push(data);
      if (collected.length >= count) {
        clearTimeout(timer);
        socket.off(event as string, handler);
        resolve(collected);
      }
    };
    socket.on(event as string, handler);
  });
}

let portCounter = 19_000;
function nextPort(): number {
  return portCounter++;
}

function connectClient(port: number): TypedClientSocket {
  return ioClient(`http://localhost:${port}`, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
  }) as TypedClientSocket;
}

describe("WorldSimServer E2E", () => {
  let server: WorldSimServer | null = null;
  let client: TypedClientSocket | null = null;

  afterEach(async () => {
    if (client?.connected) client.disconnect();
    client = null;
    if (server) {
      try { await server.close(); } catch { /* ignore */ }
    }
    server = null;
  });

  it("sends world:snapshot on client connect", async () => {
    const port = nextPort();
    server = new WorldSimServer(
      {
        worldId: "e2e-snapshot",
        maxTicks: 1,
        tickIntervalMs: 0,
        llm: { baseURL: "http://fake", apiKey: "fake", model: "fake" },
      },
      { port },
    );
    server.addAgent({ id: "p1", role: "person", name: "Alice", systemPrompt: "Test" });
    server.addAgent({ id: "p2", role: "person", name: "Bob", systemPrompt: "Test" });

    // Start only HTTP server
    await server.listen();

    // Connect client
    client = connectClient(port);
    const snapshot = await waitForEvent(client, "world:snapshot") as WorldSnapshot;

    expect(snapshot).toBeDefined();
    expect(snapshot.worldId).toBe("e2e-snapshot");
    expect(snapshot.agents).toHaveLength(2);
    expect(snapshot.agents.map((a) => a.name).sort()).toEqual(["Alice", "Bob"]);
    expect(snapshot.timestamp).toBeDefined();
  }, 10_000);

  it("streams world:tick events during simulation", async () => {
    const port = nextPort();
    server = new WorldSimServer(
      {
        worldId: "e2e-ticks",
        maxTicks: 3,
        tickIntervalMs: 50,
        llm: { baseURL: "http://fake", apiKey: "fake", model: "fake" },
      },
      { port },
    );
    server.addAgent({ id: "p1", role: "person", name: "Alice", systemPrompt: "Test" });

    // 1. Start HTTP
    await server.listen();

    // 2. Connect client and wait for snapshot
    client = connectClient(port);
    await waitForEvent(client, "world:snapshot");

    // 3. Start collecting ticks BEFORE simulation starts
    const tickPromise = collectEvents(client, "world:tick", 3);

    // 4. Start simulation (non-blocking)
    const startPromise = server.start();

    const ticks = await tickPromise as TickEvent[];
    expect(ticks).toHaveLength(3);
    expect(ticks[0].tick).toBe(1);
    expect(ticks[1].tick).toBe(2);
    expect(ticks[2].tick).toBe(3);
    expect(ticks[0].totalAgents).toBe(1);

    await startPromise;
  }, 15_000);

  it("streams agent:action events", async () => {
    const port = nextPort();
    server = new WorldSimServer(
      {
        worldId: "e2e-actions",
        maxTicks: 2,
        tickIntervalMs: 50,
        llm: { baseURL: "http://fake", apiKey: "fake", model: "fake" },
      },
      { port },
    );
    server.addAgent({
      id: "p1",
      role: "person",
      name: "Alice",
      systemPrompt: "Test",
      iterationsPerTick: 1,
    });

    await server.listen();
    client = connectClient(port);
    await waitForEvent(client, "world:snapshot");

    const actionPromise = collectEvents(client, "agent:action", 1);
    const startPromise = server.start();

    const actions = await actionPromise as AgentActionEvent[];
    expect(actions.length).toBeGreaterThanOrEqual(1);
    expect(actions[0].agentId).toBe("p1");
    expect(actions[0].agentName).toBe("Alice");
    expect(actions[0].action).toBeDefined();
    expect(actions[0].timestamp).toBeDefined();

    await startPromise;
  }, 15_000);

  it("streams agent:status events when pausing via socket command", async () => {
    const port = nextPort();
    server = new WorldSimServer(
      {
        worldId: "e2e-status",
        maxTicks: 5,
        tickIntervalMs: 200,
        llm: { baseURL: "http://fake", apiKey: "fake", model: "fake" },
      },
      { port },
    );
    server.addAgent({ id: "p1", role: "person", name: "Alice", systemPrompt: "Test" });

    await server.listen();
    client = connectClient(port);
    await waitForEvent(client, "world:snapshot");

    const statusPromise = collectEvents(client, "agent:status", 1);
    const startPromise = server.start();

    // Wait for first tick to ensure agent is running, then pause
    await waitForEvent(client, "world:tick");
    client.emit("command:pause", { agentId: "p1", reason: "E2E test" });

    const statuses = await statusPromise as AgentStatusEvent[];
    expect(statuses.length).toBeGreaterThanOrEqual(1);
    expect(statuses[0].agentId).toBe("p1");
    expect(statuses[0].newStatus).toBe("paused");
    expect(statuses[0].agentName).toBe("Alice");

    await startPromise;
  }, 15_000);

  it("subscribe:agent room receives events for that agent", async () => {
    const port = nextPort();
    server = new WorldSimServer(
      {
        worldId: "e2e-rooms",
        maxTicks: 3,
        tickIntervalMs: 50,
        llm: { baseURL: "http://fake", apiKey: "fake", model: "fake" },
      },
      { port },
    );
    server.addAgent({ id: "p1", role: "person", name: "Alice", systemPrompt: "Test", iterationsPerTick: 1 });
    server.addAgent({ id: "p2", role: "person", name: "Bob", systemPrompt: "Test", iterationsPerTick: 1 });

    await server.listen();
    client = connectClient(port);
    await waitForEvent(client, "world:snapshot");

    // Subscribe to Alice only
    client.emit("subscribe:agent", "p1");

    const allActions: AgentActionEvent[] = [];
    client.on("agent:action", (data) => allActions.push(data));

    await server.start();

    // Should have received actions (global broadcast + room for p1)
    const aliceActions = allActions.filter((a) => a.agentId === "p1");
    expect(aliceActions.length).toBeGreaterThan(0);
  }, 15_000);

  it("request:snapshot returns current state mid-simulation", async () => {
    const port = nextPort();
    server = new WorldSimServer(
      {
        worldId: "e2e-req-snap",
        maxTicks: 4,
        tickIntervalMs: 200,
        llm: { baseURL: "http://fake", apiKey: "fake", model: "fake" },
      },
      { port },
    );
    server.addAgent({ id: "p1", role: "person", name: "Alice", systemPrompt: "Test" });

    await server.listen();
    client = connectClient(port);

    const initial = await waitForEvent(client, "world:snapshot") as WorldSnapshot;
    expect(initial).toBeDefined();

    const startPromise = server.start();

    // Wait 2 ticks
    await waitForEvent(client, "world:tick");
    await waitForEvent(client, "world:tick");

    // Request fresh snapshot
    const snapPromise = waitForEvent(client, "world:snapshot");
    client.emit("request:snapshot");
    const midSnap = await snapPromise as WorldSnapshot;

    expect(midSnap.tick).toBeGreaterThanOrEqual(2);
    expect(midSnap.agents).toHaveLength(1);
    expect(midSnap.agents[0].name).toBe("Alice");

    await startPromise;
  }, 15_000);

  it("world:status updates on stop command", async () => {
    const port = nextPort();
    server = new WorldSimServer(
      {
        worldId: "e2e-world-stop",
        maxTicks: 100,
        tickIntervalMs: 100,
        llm: { baseURL: "http://fake", apiKey: "fake", model: "fake" },
      },
      { port },
    );
    server.addAgent({ id: "p1", role: "person", name: "Alice", systemPrompt: "Test" });

    await server.listen();
    client = connectClient(port);
    await waitForEvent(client, "world:snapshot");

    // Collect world:status — expect "bootstrapping" then "stopped"
    const statuses: Array<{ status: string }> = [];
    client.on("world:status", (data) => statuses.push(data));

    const startPromise = server.start();

    // Wait for first tick, then stop
    await waitForEvent(client, "world:tick");
    client.emit("command:world:stop");

    await startPromise;

    expect(statuses.map((s) => s.status)).toContain("stopped");
  }, 15_000);
});
