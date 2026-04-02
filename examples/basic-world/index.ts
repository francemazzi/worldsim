import { WorldEngine, ConsoleLoggerPlugin } from "@worldsim/core";
import type { AgentControlEvent, AgentStatus } from "@worldsim/core";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const world = new WorldEngine({
  worldId: "my-first-world",
  maxTicks: 20,
  tickIntervalMs: 500,
  llm: {
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4o-mini",
  },
  rulesPath: {
    json: [path.join(__dirname, "rules/*.json")],
  },
});

world.use(ConsoleLoggerPlugin);

world.use({
  name: "lifecycle-observer",
  version: "1.0.0",
  async onAgentStatusChange(
    event: AgentControlEvent,
    oldStatus: AgentStatus,
    newStatus: AgentStatus,
  ) {
    if (newStatus === "stopped") {
      console.log(
        `Agent ${event.agentId} stopped by ${event.requestedBy}: ${event.reason}`,
      );
    }
  },
});

world.addAgent({
  id: "governance-1",
  role: "control",
  name: "Governance Agent",
  systemPrompt: `Sei un agente di governance. Monitora le regole e usa il tool
    'control_agent' per sospendere agenti che le violano. Usa 'pause' per
    violazioni temporanee, 'stop' solo per violazioni critiche irreversibili.`,
});

const personalities = ["curiosa", "scettica", "entusiasta", "cauta", "innovativa"];
for (let i = 0; i < 5; i++) {
  world.addAgent({
    id: `person-${i}`,
    role: "person",
    name: `Persona ${i}`,
    iterationsPerTick: 3,
    systemPrompt: `Sei una persona con personalità ${personalities[i]}.`,
  });
}

world.on("tick", (tick: number) => {
  if (tick === 5) {
    world.pauseAgent("person-2", "Fase di test: sospeso temporaneamente");
    console.log("Statuses:", world.getAgentStatuses());
  }
  if (tick === 8) {
    world.resumeAgent("person-2");
  }
  if (tick === 15) {
    world.stopAgent("person-4", "Missione completata");
  }
});

await world.start();

process.on("SIGINT", async () => {
  await world.stop();
  console.log("World stopped.");
  process.exit(0);
});
