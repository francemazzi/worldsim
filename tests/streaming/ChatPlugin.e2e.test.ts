import { describe, it, expect, vi, afterEach } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { WorldSimServer } from "../../src/streaming/WorldSimServer.js";
import { ChatPlugin } from "../../src/plugins/built-in/ChatPlugin.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  WorldSnapshot,
} from "../../src/streaming/types.js";
import type { ChatResponsePayload } from "../../src/types/ChatTypes.js";

/**
 * Mock the LLM so we don't need a real API key.
 * The chat() mock returns a conversational response.
 * The chatStream() mock yields chunks.
 */
vi.mock("../../src/llm/OpenAICompatAdapter.js", () => {
  return {
    OpenAICompatAdapter: class {
      async chat() {
        return {
          content: "Ciao! Sto bene, grazie per chiedermelo. Ho molta energia oggi!",
          usage: { inputTokens: 100, outputTokens: 20 },
        };
      }
      async chatWithTools() {
        return {
          content: '{"actionType":"observe","content":"osservo","stateUpdate":{"mood":"neutral","energy":95}}',
          usage: { inputTokens: 10, outputTokens: 5 },
        };
      }
      async *chatStream() {
        const chunks = ["Ciao! ", "Sto bene, ", "grazie per ", "chiedermelo."];
        for (const chunk of chunks) {
          yield chunk;
        }
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

let portCounter = 20_000;
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

describe("ChatPlugin E2E", () => {
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

  function createServer(port: number): WorldSimServer {
    const s = new WorldSimServer(
      {
        worldId: "chat-test",
        maxTicks: 100,
        tickIntervalMs: 500,
        llm: { baseURL: "http://fake", apiKey: "fake", model: "fake" },
      },
      { port },
    );
    s.use(new ChatPlugin());
    s.addAgent({
      id: "alice",
      role: "person",
      name: "Alice",
      systemPrompt: "You are Alice, a friendly person.",
      profile: {
        name: "Alice",
        age: 30,
        profession: "Designer",
        personality: ["friendly", "creative"],
        goals: ["Design a new product"],
      },
    });
    return s;
  }

  it("chat:send returns chat:response with agent reply", async () => {
    const port = nextPort();
    server = createServer(port);

    // Start server + simulation
    await server.listen();
    client = connectClient(port);
    await waitForEvent(client, "world:snapshot");

    // Start simulation in background to trigger bootstrap (configures ChatPlugin)
    const startPromise = server.start();

    // Wait for first tick (ensures bootstrap is done)
    await waitForEvent(client, "world:tick");

    // Send a chat message
    const responsePromise = waitForEvent(client, "chat:response");
    client.emit("chat:send", { agentId: "alice", message: "Ciao, come stai?" });

    const response = await responsePromise as ChatResponsePayload;

    expect(response).toBeDefined();
    expect(response.agentId).toBe("alice");
    expect(response.agentName).toBe("Alice");
    expect(response.sessionId).toBeDefined();
    expect(response.message).toContain("Ciao");
    expect(response.state).toBeDefined();
    expect(response.state.mood).toBeDefined();
    expect(typeof response.state.energy).toBe("number");
    expect(response.timestamp).toBeDefined();

    // Stop simulation
    client.emit("command:world:stop");
    await startPromise;
  }, 15_000);

  it("chat session persists across multiple messages", async () => {
    const port = nextPort();
    server = createServer(port);

    await server.listen();
    client = connectClient(port);
    await waitForEvent(client, "world:snapshot");

    const startPromise = server.start();
    await waitForEvent(client, "world:tick");

    // First message
    const resp1Promise = waitForEvent(client, "chat:response");
    client.emit("chat:send", { agentId: "alice", message: "Ciao!" });
    const resp1 = await resp1Promise as ChatResponsePayload;
    const sessionId = resp1.sessionId;

    // Second message with same session
    const resp2Promise = waitForEvent(client, "chat:response");
    client.emit("chat:send", { agentId: "alice", message: "Che fai?", sessionId });
    const resp2 = await resp2Promise as ChatResponsePayload;

    expect(resp2.sessionId).toBe(sessionId);

    // Request history
    const historyPromise = waitForEvent(client, "chat:history");
    client.emit("chat:history", { agentId: "alice", sessionId });
    const history = await historyPromise as any;

    expect(history.messages).toBeDefined();
    // Should have 4 messages: user1, agent1, user2, agent2
    expect(history.messages.length).toBe(4);
    expect(history.messages[0].role).toBe("user");
    expect(history.messages[1].role).toBe("agent");
    expect(history.messages[2].role).toBe("user");
    expect(history.messages[3].role).toBe("agent");

    client.emit("command:world:stop");
    await startPromise;
  }, 15_000);

  it("chat:send with stream:true emits chunks then stream:end", async () => {
    const port = nextPort();
    server = createServer(port);

    await server.listen();
    client = connectClient(port);
    await waitForEvent(client, "world:snapshot");

    const startPromise = server.start();
    await waitForEvent(client, "world:tick");

    // Collect all chunks that arrive before stream:end
    const chunks: any[] = [];
    client.on("chat:stream:chunk" as any, (data: any) => chunks.push(data));

    const endPromise = waitForEvent(client, "chat:stream:end");

    client.emit("chat:send", {
      agentId: "alice",
      message: "Ciao!",
      stream: true,
    });

    const endResponse = await endPromise as ChatResponsePayload;

    // Verify at least 1 chunk arrived (mock yields 4, but Socket.IO may batch in test)
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    // All chunks should reference alice
    for (const c of chunks) {
      expect(c.agentId).toBe("alice");
      expect(typeof c.chunk).toBe("string");
      expect(typeof c.index).toBe("number");
    }

    // Concatenated chunks should match the final response
    const reconstructed = chunks.map((c: any) => c.chunk).join("");
    expect(endResponse.message).toBe(reconstructed);

    // Verify final response
    expect(endResponse.agentId).toBe("alice");
    expect(endResponse.agentName).toBe("Alice");
    expect(endResponse.sessionId).toBeDefined();

    client.emit("command:world:stop");
    await startPromise;
  }, 15_000);

  it("chat:send for non-existent agent returns error", async () => {
    const port = nextPort();
    server = createServer(port);

    await server.listen();
    client = connectClient(port);
    await waitForEvent(client, "world:snapshot");

    const startPromise = server.start();
    await waitForEvent(client, "world:tick");

    const errorPromise = waitForEvent(client, "error");
    client.emit("chat:send", { agentId: "nonexistent", message: "Hello?" });

    const error = await errorPromise as { message: string };
    expect(error.message).toContain("nonexistent");

    client.emit("command:world:stop");
    await startPromise;
  }, 15_000);

  it("returns error when ChatPlugin is not registered", async () => {
    const port = nextPort();
    // Server WITHOUT ChatPlugin
    server = new WorldSimServer(
      {
        worldId: "no-chat-test",
        maxTicks: 5,
        tickIntervalMs: 100,
        llm: { baseURL: "http://fake", apiKey: "fake", model: "fake" },
      },
      { port },
    );
    server.addAgent({ id: "p1", role: "person", name: "Bob", systemPrompt: "Test" });

    await server.listen();
    client = connectClient(port);
    await waitForEvent(client, "world:snapshot");

    const errorPromise = waitForEvent(client, "error");
    client.emit("chat:send", { agentId: "p1", message: "Hello?" });

    const error = await errorPromise as { message: string };
    expect(error.message).toContain("Chat plugin not registered");
  }, 10_000);
});
