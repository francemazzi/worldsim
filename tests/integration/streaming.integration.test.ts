import { describe, it, expect, afterEach } from "vitest";
import { config } from "dotenv";
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

config({ path: ".env" });

const apiKey = process.env["OPENAI_API_KEY"];

type TypedClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

describe.skipIf(!apiKey)("Streaming integration — real LLM", () => {
  let server: WorldSimServer | null = null;
  let client: TypedClientSocket | null = null;

  afterEach(async () => {
    if (client?.connected) client.disconnect();
    client = null;
    if (server) {
      try { await server.close(); } catch { /* */ }
    }
    server = null;
  });

  it("streams real agent actions over Socket.IO", async () => {
    const port = 19_200;

    server = new WorldSimServer(
      {
        worldId: "streaming-real-test",
        maxTicks: 3,
        tickIntervalMs: 100,
        llm: {
          baseURL: "https://api.openai.com/v1",
          apiKey: apiKey!,
          model: "gpt-4o-mini",
          temperature: 0.7,
          maxTokens: 200,
        },
      },
      { port },
    );

    server.addAgent({
      id: "alice",
      role: "person",
      name: "Alice",
      iterationsPerTick: 1,
      systemPrompt: "Sei Alice, una scienziata curiosa. Fai domande sul mondo che ti circonda e proponi esperimenti.",
      profile: {
        name: "Alice",
        age: 32,
        profession: "Scienziata",
        personality: ["curiosa", "analitica", "entusiasta"],
        goals: ["Scoprire nuove leggi della natura", "Collaborare con altri ricercatori"],
      },
    });

    server.addAgent({
      id: "bob",
      role: "person",
      name: "Bob",
      iterationsPerTick: 1,
      systemPrompt: "Sei Bob, un filosofo scettico. Metti in discussione le idee altrui, proponi riflessioni profonde.",
      profile: {
        name: "Bob",
        age: 45,
        profession: "Filosofo",
        personality: ["scettico", "riflessivo", "provocatorio"],
        goals: ["Trovare la verità", "Sfidare le assunzioni comuni"],
      },
    });

    // Start HTTP server
    await server.listen();

    // Connect client
    client = ioClient(`http://localhost:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    }) as TypedClientSocket;

    // Collect everything
    const snapshots: WorldSnapshot[] = [];
    const ticks: TickEvent[] = [];
    const actions: AgentActionEvent[] = [];
    const statuses: AgentStatusEvent[] = [];
    const worldStatuses: string[] = [];

    client.on("world:snapshot", (snap) => snapshots.push(snap));
    client.on("world:tick", (data) => ticks.push(data));
    client.on("agent:action", (data) => actions.push(data));
    client.on("agent:status", (data) => statuses.push(data));
    client.on("world:status", (data) => worldStatuses.push(data.status));

    // Wait for initial connection
    await new Promise<void>((resolve) => {
      client!.once("world:snapshot", () => resolve());
    });

    // Run simulation
    await server.start();

    // ─── Print full log ────────────────────────────────────────────
    console.log("\n" + "=".repeat(70));
    console.log("  STREAMING INTEGRATION TEST — REAL LLM OUTPUT");
    console.log("=".repeat(70));

    console.log("\n📡 Initial Snapshot:");
    console.log(`   World: ${snapshots[0]?.worldId} | Status: ${snapshots[0]?.status}`);
    for (const a of snapshots[0]?.agents ?? []) {
      console.log(`   Agent: ${a.name} (${a.role}) — ${a.profile?.profession ?? "?"}`);
    }

    console.log(`\n🔄 World status flow: ${worldStatuses.join(" → ")}`);
    console.log(`\n📊 Ticks received: ${ticks.length}`);

    for (const tick of ticks) {
      console.log(`\n${"─".repeat(50)}`);
      console.log(`  TICK ${tick.tick} (agents: ${tick.activeAgents}/${tick.totalAgents})`);
      console.log(`${"─".repeat(50)}`);

      const tickActions = actions.filter((a) => a.tick === tick.tick);
      for (const action of tickActions) {
        console.log(`\n  🤖 ${action.agentName} [${action.action.actionType}]`);
        const payload = typeof action.action.payload === "string"
          ? action.action.payload
          : JSON.stringify(action.action.payload, null, 2);
        // Truncate very long payloads
        const display = payload.length > 500 ? payload.slice(0, 500) + "..." : payload;
        console.log(`     ${display}`);
      }
    }

    if (statuses.length > 0) {
      console.log(`\n🔀 Agent status changes:`);
      for (const s of statuses) {
        console.log(`   ${s.agentName}: ${s.oldStatus} → ${s.newStatus} (${s.event.reason ?? "no reason"})`);
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log(`  TOTALS: ${ticks.length} ticks, ${actions.length} actions, ${statuses.length} status changes`);
    console.log("=".repeat(70) + "\n");

    // ─── Assertions ────────────────────────────────────────────────
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0].agents).toHaveLength(2);

    expect(ticks).toHaveLength(3);

    expect(actions.length).toBeGreaterThan(0);
    // Each action should have real content, not mock
    for (const action of actions) {
      expect(action.agentName).toBeTruthy();
      expect(action.action.payload).toBeDefined();
      expect(action.timestamp).toBeTruthy();
    }

    expect(worldStatuses).toContain("running");
  }, 120_000);
});
