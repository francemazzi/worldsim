/**
 * Long-running integration test: real LLM, real interactions, real streaming.
 * Tests whether agents actually converse with each other over Socket.IO.
 */
import { describe, it, expect, afterEach } from "vitest";
import { config } from "dotenv";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { WorldSimServer } from "../../src/streaming/WorldSimServer.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  AgentActionEvent,
  TickEvent,
} from "../../src/streaming/types.js";

config({ path: ".env" });
const apiKey = process.env["OPENAI_API_KEY"];

type TypedClientSocket = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

describe.skipIf(!apiKey)("Streaming long integration — real conversations", () => {
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

  it("4 agents converse for 8 ticks — sequential processing for real dialogue", async () => {
    const port = 19_300;

    server = new WorldSimServer(
      {
        worldId: "piazza-del-villaggio",
        maxTicks: 8,
        tickIntervalMs: 100,
        maxConcurrentAgents: 1, // Sequential! So agents see each other's messages within a tick
        llm: {
          baseURL: "https://api.openai.com/v1",
          apiKey: apiKey!,
          model: "gpt-4o-mini",
          temperature: 0.8,
          maxTokens: 250,
        },
      },
      { port },
    );

    // ── Agenti con personalità distinte ──

    server.addAgent({
      id: "maria",
      role: "person",
      name: "Maria",
      iterationsPerTick: 1,
      systemPrompt: `Sei Maria, una vecchia contadina di 72 anni in un piccolo villaggio italiano.
Parli in italiano con espressioni dialettali. Sei saggia ma un po' brontolona.
Ti preoccupi del raccolto e del tempo. Rispondi SEMPRE a quello che dicono gli altri,
non ignorare mai i messaggi che ricevi. Se qualcuno ti parla, rispondi direttamente.`,
      profile: {
        name: "Maria",
        age: 72,
        profession: "Contadina",
        personality: ["saggia", "brontolona", "generosa", "superstiziosa"],
        goals: ["Proteggere il raccolto dalla siccità", "Tramandare le tradizioni"],
      },
    });

    server.addAgent({
      id: "luca",
      role: "person",
      name: "Luca",
      iterationsPerTick: 1,
      systemPrompt: `Sei Luca, un giovane ingegnere informatico di 28 anni tornato al villaggio.
Parli in italiano. Sei entusiasta della tecnologia ma rispetti le tradizioni.
Vuoi portare innovazione nel villaggio. Rispondi SEMPRE a quello che dicono gli altri,
reagisci ai loro messaggi. Se qualcuno ti parla, rispondi direttamente a loro.`,
      profile: {
        name: "Luca",
        age: 28,
        profession: "Ingegnere informatico",
        personality: ["entusiasta", "rispettoso", "innovativo", "un po' ingenuo"],
        goals: ["Portare internet veloce al villaggio", "Creare un'app per vendere prodotti locali"],
      },
    });

    server.addAgent({
      id: "don-paolo",
      role: "person",
      name: "Don Paolo",
      iterationsPerTick: 1,
      systemPrompt: `Sei Don Paolo, il parroco del villaggio, 55 anni.
Parli in italiano con tono calmo e riflessivo. Sei mediatore nelle dispute.
Cerchi di tenere unita la comunità. Rispondi SEMPRE a quello che dicono gli altri,
offri consigli e cerca di mediare. Se c'è un conflitto, intervieni.`,
      profile: {
        name: "Don Paolo",
        age: 55,
        profession: "Parroco",
        personality: ["calmo", "saggio", "mediatore", "un po' conservatore"],
        goals: ["Mantenere la pace nel villaggio", "Organizzare la festa patronale"],
      },
    });

    server.addAgent({
      id: "giulia",
      role: "person",
      name: "Giulia",
      iterationsPerTick: 1,
      systemPrompt: `Sei Giulia, una ragazza di 22 anni, nipote di Maria, studentessa di agronomia.
Parli in italiano. Sei combattuta tra restare al villaggio e andare in città.
Ami la nonna Maria ma vuoi anche una carriera. Rispondi SEMPRE a quello che dicono gli altri.
Interagisci con tutti, specialmente con la nonna Maria e con Luca che ha la tua età.`,
      profile: {
        name: "Giulia",
        age: 22,
        profession: "Studentessa di agronomia",
        personality: ["indecisa", "affettuosa", "ambiziosa", "curiosa"],
        goals: ["Decidere se restare o partire", "Modernizzare la fattoria della nonna"],
      },
    });

    // Start HTTP
    await server.listen();

    // Connect client
    client = ioClient(`http://localhost:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    }) as TypedClientSocket;

    const ticks: TickEvent[] = [];
    const actions: AgentActionEvent[] = [];

    client.on("world:tick", (data) => ticks.push(data));
    client.on("agent:action", (data) => actions.push(data));

    await new Promise<void>((resolve) => {
      client!.once("world:snapshot", () => resolve());
    });

    // Run
    await server.start();

    // ─── Print full conversation ───
    console.log("\n");
    console.log("╔" + "═".repeat(72) + "╗");
    console.log("║  PIAZZA DEL VILLAGGIO — Simulazione con LLM reale (8 tick)          ║");
    console.log("║  Agenti: Maria, Luca, Don Paolo, Giulia                             ║");
    console.log("║  maxConcurrentAgents: 1 (sequenziale per dialogo reale)              ║");
    console.log("╚" + "═".repeat(72) + "╝");

    for (const tick of ticks) {
      console.log(`\n┌${"─".repeat(72)}┐`);
      console.log(`│  TICK ${tick.tick}                                                            │`);
      console.log(`└${"─".repeat(72)}┘`);

      const tickActions = actions.filter((a) => a.tick === tick.tick);
      for (const action of tickActions) {
        const emoji = {
          maria: "👵",
          luca: "👨‍💻",
          "don-paolo": "⛪",
          giulia: "👩‍🎓",
        }[action.agentId] ?? "🤖";

        const payload = typeof action.action.payload === "string"
          ? action.action.payload
          : JSON.stringify(action.action.payload);

        // Word-wrap at 68 chars
        const lines: string[] = [];
        const words = payload.split(" ");
        let line = "";
        for (const word of words) {
          if (line.length + word.length + 1 > 68) {
            lines.push(line);
            line = word;
          } else {
            line = line ? `${line} ${word}` : word;
          }
        }
        if (line) lines.push(line);

        console.log(`\n  ${emoji} ${action.agentName} [${action.action.actionType}]`);
        for (const l of lines) {
          console.log(`     ${l}`);
        }
      }
    }

    // ─── Statistics ───
    const agentActionCounts = new Map<string, number>();
    const agentActionTypes = new Map<string, Map<string, number>>();

    for (const a of actions) {
      agentActionCounts.set(a.agentName, (agentActionCounts.get(a.agentName) ?? 0) + 1);
      if (!agentActionTypes.has(a.agentName)) agentActionTypes.set(a.agentName, new Map());
      const types = agentActionTypes.get(a.agentName)!;
      types.set(a.action.actionType, (types.get(a.action.actionType) ?? 0) + 1);
    }

    console.log(`\n${"═".repeat(74)}`);
    console.log("  STATISTICHE");
    console.log(`${"═".repeat(74)}`);
    console.log(`  Tick totali: ${ticks.length}`);
    console.log(`  Azioni totali: ${actions.length}`);
    console.log("");
    for (const [name, count] of agentActionCounts) {
      const types = agentActionTypes.get(name)!;
      const typeStr = Array.from(types.entries()).map(([t, c]) => `${t}:${c}`).join(", ");
      console.log(`  ${name}: ${count} azioni (${typeStr})`);
    }
    console.log(`${"═".repeat(74)}\n`);

    // ─── Assertions ───
    expect(ticks).toHaveLength(8);
    expect(actions.length).toBeGreaterThan(0);

    // Each agent should have produced at least some actions
    for (const name of ["Maria", "Luca", "Don Paolo", "Giulia"]) {
      expect(agentActionCounts.get(name)).toBeGreaterThan(0);
    }
  }, 180_000);
});
