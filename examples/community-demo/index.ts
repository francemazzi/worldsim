/**
 * Villaggio del Sole — Community Policy Simulation Demo
 *
 * A small Italian village faces a new water rationing policy.
 * Watch how 8 agents with distinct personalities react, form coalitions,
 * comply or resist.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx examples/community-demo/index.ts
 *   # Then open http://localhost:4400
 */
import {
  WorldEngine,
  ConsoleLoggerPlugin,
  LifeSkillsPlugin,
  InMemoryMemoryStore,
  InMemoryGraphStore,
  studioPlugin,
} from "worldsim";
import { reportGeneratorPlugin } from "../../src/plugins/built-in/ReportGeneratorPlugin.js";
import { RealWorldToolsPlugin } from "../../src/plugins/built-in/RealWorldToolsPlugin.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load scenario ──────────────────────────────────────────────────
const scenario = JSON.parse(
  readFileSync(join(__dirname, "scenario.json"), "utf-8"),
);
const triggerRules = JSON.parse(
  readFileSync(join(__dirname, "rules/water-rationing.json"), "utf-8"),
);

// ── Validate env ───────────────────────────────────────────────────
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Error: OPENAI_API_KEY environment variable is required.");
  console.error("Usage: OPENAI_API_KEY=sk-... npx tsx examples/community-demo/index.ts");
  process.exit(1);
}

const baseURL = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const model = process.env.LLM_MODEL ?? "gpt-4o-mini";

// ── Create engine ──────────────────────────────────────────────────
const memoryStore = new InMemoryMemoryStore();
const graphStore = new InMemoryGraphStore();

const world = new WorldEngine({
  worldId: scenario.name,
  maxTicks: scenario.maxTicks,
  tickIntervalMs: scenario.tickIntervalMs,
  llm: { baseURL, apiKey, model },
  rulesPath: {
    json: [join(__dirname, "rules/community-rules.json")],
  },
  memoryStore,
  graphStore,
});

// ── Plugins ────────────────────────────────────────────────────────
world.use(ConsoleLoggerPlugin);

world.use(
  new LifeSkillsPlugin(["farming", "cooking", "social", "technology", "crafting", "spiritual", "academic"]),
);

// Real-world tools: agents can check weather and observe environment
if (scenario.dataSources) {
  world.use(new RealWorldToolsPlugin({ dataSources: scenario.dataSources }));
}

const report = reportGeneratorPlugin({ engine: world });
world.use(report.plugin);

world.use(
  studioPlugin({
    engine: world,
    port: 4400,
    open: true,
    memoryStore,
    graphStore,
    reportGetter: () => report.getReport(),
  }),
);

// ── Add agents from scenario ───────────────────────────────────────
for (const agent of scenario.agents) {
  world.addAgent(agent);
}

// Add governance agent
world.addAgent({
  id: "governance",
  role: "control",
  name: "Governance Agent",
  systemPrompt: `Sei l'agente di governance del Villaggio del Sole. Monitora che le regole
    della comunità vengano rispettate. Usa 'pause' per violazioni moderate
    (linguaggio irrispettoso, minacce). Usa 'stop' solo per violazioni gravi
    e ripetute. Dopo il tick 10, monitora anche il rispetto del razionamento idrico.`,
});

// ── Policy trigger ─────────────────────────────────────────────────
const triggerTick = scenario.trigger?.atTick ?? 10;
const announcement = scenario.trigger?.announcement ?? "";

world.on("tick", (tick: number) => {
  if (tick === triggerTick && announcement) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  POLICY TRIGGER — Tick ${tick}`);
    console.log(`  ${announcement.slice(0, 100)}...`);
    console.log(`${"=".repeat(60)}\n`);
  }
});

// ── Start simulation ───────────────────────────────────────────────
console.log(`\n  Villaggio del Sole — Community Policy Simulation`);
console.log(`  ${scenario.agents.length} agents | ${scenario.maxTicks} ticks | Policy trigger at tick ${triggerTick}`);
console.log(`  Studio dashboard: http://localhost:4400\n`);

await world.start();

// ── Print report summary ───────────────────────────────────────────
const data = report.getReport();
if (data) {
  console.log(`\n${"=".repeat(60)}`);
  console.log("  SIMULATION REPORT");
  console.log(`${"=".repeat(60)}`);
  console.log(`  Duration: ${(data.summary.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Ticks: ${data.summary.totalTicks}`);
  console.log(`  Total actions: ${data.summary.totalActions}`);
  console.log(`  Speaks: ${data.metrics.totalSpeaks}`);
  console.log(`  Observations: ${data.metrics.totalObservations}`);
  console.log(`  Tool calls: ${data.metrics.totalToolCalls}`);
  console.log(`  Status changes: ${data.metrics.statusChanges}`);
  console.log(`\n  Per-agent summary:`);
  for (const agent of data.agents) {
    if (agent.role === "control") continue;
    const moodEnd = agent.moodTrajectory.at(-1)?.mood ?? "?";
    const energyEnd = agent.energyTrajectory.at(-1)?.energy ?? 0;
    console.log(`    ${agent.name}: ${agent.totalActions} actions, mood=${moodEnd}, energy=${energyEnd}`);
  }
  console.log(`${"=".repeat(60)}\n`);
}

// Keep process alive for Studio
process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await world.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await world.stop();
  process.exit(0);
});
