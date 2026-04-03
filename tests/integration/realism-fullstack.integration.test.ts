/**
 * Full-stack realism test: Redis memory + Neo4j graph + real LLM + LifeSkillsPlugin + Socket.IO streaming.
 * Verifies: memory persistence, relationship formation, tool usage, state evolution, conflict.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { config } from "dotenv";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { WorldSimServer } from "../../src/streaming/WorldSimServer.js";
import { LifeSkillsPlugin } from "../../src/plugins/built-in/LifeSkillsPlugin.js";
import { resolveToolNames } from "../../src/plugins/built-in/skillResolver.js";
import { RedisMemoryStore } from "../../src/stores/RedisMemoryStore.js";
import { Neo4jGraphStore } from "../../src/stores/Neo4jGraphStore.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  AgentActionEvent,
  TickEvent,
} from "../../src/streaming/types.js";

config({ path: ".env" });
const apiKey = process.env["OPENAI_API_KEY"];

type TypedClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

describe.skipIf(!apiKey)("Full-stack realism integration", () => {
  let redis: RedisMemoryStore;
  let neo4j: Neo4jGraphStore;
  let server: WorldSimServer | null = null;
  let client: TypedClientSocket | null = null;

  beforeAll(async () => {
    redis = new RedisMemoryStore("redis://localhost:16379");
    neo4j = new Neo4jGraphStore("bolt://localhost:7687", "neo4j", "testpassword");

    // Clear previous test data
    await neo4j.clearAll();
    for (const id of ["maria", "luca", "don-paolo", "giulia"]) {
      await redis.clear(id);
    }
  });

  afterAll(async () => {
    await redis.disconnect();
    await neo4j.disconnect();
  });

  afterEach(async () => {
    if (client?.connected) client.disconnect();
    client = null;
    if (server) {
      try { await server.close(); } catch { /* ignore */ }
    }
    server = null;
  });

  it("4 agents with skills converse, remember, and conflict over 6 ticks", async () => {
    const port = 19_400;

    server = new WorldSimServer(
      {
        worldId: "piazza-realism-test",
        maxTicks: 6,
        tickIntervalMs: 200,
        maxConcurrentAgents: 1, // Sequential for real dialogue
        llm: {
          baseURL: "https://api.openai.com/v1",
          apiKey: apiKey!,
          model: "gpt-4o-mini",
          temperature: 0.9,
          maxTokens: 400,
        },
        memoryStore: redis,
        graphStore: neo4j,
      },
      { port },
    );

    // Register LifeSkillsPlugin with all categories
    server.use(new LifeSkillsPlugin());

    // Maria: farmer — brontolona, testarda, contro la tecnologia
    server.addAgent({
      id: "maria",
      role: "person",
      name: "Maria",
      iterationsPerTick: 1,
      profile: {
        name: "Maria",
        age: 72,
        profession: "Contadina",
        personality: ["saggia", "brontolona", "superstiziosa", "testarda", "diffidente verso la tecnologia"],
        goals: ["Proteggere il raccolto dalla siccita", "Convincere Giulia a restare al villaggio", "Opporsi alle diavolerie tecnologiche di Luca"],
        skills: ["farming"],
      },
      toolNames: resolveToolNames(["farming"]),
    });

    // Luca: tech enthusiast — in conflitto con Maria
    server.addAgent({
      id: "luca",
      role: "person",
      name: "Luca",
      iterationsPerTick: 1,
      profile: {
        name: "Luca",
        age: 28,
        profession: "Ingegnere informatico",
        personality: ["entusiasta", "testardo", "impaziente", "a volte arrogante"],
        goals: ["Portare internet veloce al villaggio", "Dimostrare che la tecnologia e meglio dei metodi vecchi", "Convincere Maria che ha torto"],
        skills: ["technology"],
      },
      toolNames: resolveToolNames(["technology"]),
    });

    // Don Paolo: mediator — sottilmente conservatore
    server.addAgent({
      id: "don-paolo",
      role: "person",
      name: "Don Paolo",
      iterationsPerTick: 1,
      profile: {
        name: "Don Paolo",
        age: 55,
        profession: "Parroco",
        personality: ["calmo", "conservatore", "mediatore", "sottilmente manipolativo"],
        goals: ["Mantenere la pace", "Organizzare la festa patronale", "Tenere il villaggio unito anche se non e d'accordo con Luca"],
        skills: ["spiritual"],
      },
      toolNames: resolveToolNames(["spiritual"]),
    });

    // Giulia: torn between tradition and modernity
    server.addAgent({
      id: "giulia",
      role: "person",
      name: "Giulia",
      iterationsPerTick: 1,
      profile: {
        name: "Giulia",
        age: 22,
        profession: "Studentessa di agronomia",
        personality: ["indecisa", "ambiziosa", "ribelle", "affettuosa con la nonna"],
        goals: ["Decidere se restare o andare in citta", "Modernizzare la fattoria della nonna senza offenderla", "Studiare nuove tecniche agricole"],
        skills: ["academic"],
      },
      toolNames: resolveToolNames(["academic"]),
    });

    // Start HTTP
    await server.listen();

    // Connect Socket.IO client
    client = ioClient(`http://localhost:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    }) as TypedClientSocket;

    const ticks: TickEvent[] = [];
    const actions: AgentActionEvent[] = [];

    client.on("world:tick", (d) => ticks.push(d));
    client.on("agent:action", (d) => actions.push(d));

    await new Promise<void>((resolve) => {
      client!.once("world:snapshot", () => resolve());
    });

    // Run simulation
    await server.start();

    // ─── Print full conversation ───
    console.log("\n");
    console.log("╔" + "═".repeat(74) + "╗");
    console.log("║  PIAZZA DEL VILLAGGIO — Test Full-Stack (Redis + Neo4j + LifeSkills)   ║");
    console.log("║  6 tick, maxConcurrentAgents: 1, temperature: 0.9                      ║");
    console.log("╚" + "═".repeat(74) + "╝");

    for (const tick of ticks) {
      console.log(`\n┌${"─".repeat(74)}┐`);
      console.log(`│  TICK ${tick.tick}                                                              │`);
      console.log(`└${"─".repeat(74)}┘`);

      const tickActions = actions.filter((a) => a.tick === tick.tick);
      for (const action of tickActions) {
        const emoji: Record<string, string> = {
          maria: "👵", luca: "👨‍💻", "don-paolo": "⛪", giulia: "👩‍🎓",
        };

        const payload = typeof action.action.payload === "string"
          ? action.action.payload
          : JSON.stringify(action.action.payload);

        const lines: string[] = [];
        const words = payload.split(" ");
        let line = "";
        for (const word of words) {
          if (line.length + word.length + 1 > 70) { lines.push(line); line = word; }
          else { line = line ? `${line} ${word}` : word; }
        }
        if (line) lines.push(line);

        console.log(`\n  ${emoji[action.agentId] ?? "🤖"} ${action.agentName} [${action.action.actionType}]`);
        for (const l of lines) console.log(`     ${l}`);
      }
    }

    // ─── Verify memory persistence ───
    const mariaMemories = await redis.getRecent("maria", 100);
    const lucaMemories = await redis.getRecent("luca", 100);
    console.log(`\n📦 Memoria persistita: Maria=${mariaMemories.length}, Luca=${lucaMemories.length}`);

    // ─── Verify relationship formation ───
    const mariaRels = await neo4j.getRelationships({ agentId: "maria" });
    const lucaRels = await neo4j.getRelationships({ agentId: "luca" });
    console.log(`🔗 Relazioni: Maria conosce ${mariaRels.length} agenti, Luca conosce ${lucaRels.length}`);
    for (const r of mariaRels) {
      console.log(`   Maria → ${r.to}: forza=${r.strength.toFixed(2)}, tipo=${r.type}`);
    }

    // ─── Verify state evolution ───
    const engine = server.getEngine();
    const agents = ["maria", "luca", "don-paolo", "giulia"];
    console.log("\n🧠 Stato finale agenti:");
    for (const id of agents) {
      const agent = engine.getAgent(id);
      if (agent) {
        const state = agent.getInternalState();
        console.log(`   ${id}: mood=${state.mood}, energy=${state.energy}, goals=${state.goals.length}`);
      }
    }

    // ─── Statistics ───
    const actionTypes = new Map<string, number>();
    for (const a of actions) {
      const t = a.action.actionType;
      actionTypes.set(t, (actionTypes.get(t) ?? 0) + 1);
    }
    console.log(`\n📊 Azioni per tipo: ${Array.from(actionTypes.entries()).map(([t, c]) => `${t}:${c}`).join(", ")}`);
    console.log(`   Totale: ${actions.length} azioni in ${ticks.length} tick`);
    console.log("═".repeat(76) + "\n");

    // ─── Assertions ───
    expect(ticks).toHaveLength(6);
    expect(actions.length).toBeGreaterThan(0);

    // All agents participated
    const agentIds = new Set(actions.map((a) => a.agentId));
    expect(agentIds.size).toBe(4);

    // Memory persisted across ticks
    expect(mariaMemories.length).toBeGreaterThanOrEqual(3);

    // Relationships formed
    expect(mariaRels.length).toBeGreaterThan(0);

    // State evolved (mood changed or energy decreased from 100)
    for (const id of agents) {
      const agent = engine.getAgent(id);
      if (agent) {
        const state = agent.getInternalState();
        const evolved = state.mood !== "neutral" || state.energy < 100;
        expect(evolved).toBe(true);
      }
    }
  }, 300_000);
});
