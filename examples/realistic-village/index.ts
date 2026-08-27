/**
 * Borgo Realistico — Perception layer demo.
 *
 * Showcases the realistic-simulation primitives end-to-end:
 *   - 4 agents distributed across 3 locations (piazza, bar, casa)
 *   - 2 entities passively emitting stimuli (a bell, a fountain)
 *   - perception mode + default `humanBasic` needs template
 *   - NeedsSatisfierPlugin auto-registers at bootstrap (see autoNeedsSatisfier)
 *   - studio dashboard exposes perception telemetry on http://localhost:4400
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npm run demo:realistic
 *
 * Optional env:
 *   LLM_BASE_URL  default https://api.openai.com/v1
 *   LLM_MODEL     default gpt-4o-mini
 *   STUDIO_PORT   default 4400
 */
import {
  WorldEngine,
  ConsoleLoggerPlugin,
  InMemoryMemoryStore,
  InMemoryGraphStore,
  studioPlugin,
} from "worldsim";
import { reportGeneratorPlugin } from "../../src/plugins/built-in/ReportGeneratorPlugin.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const scenario = JSON.parse(
  readFileSync(join(__dirname, "scenario.json"), "utf-8"),
);

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Error: OPENAI_API_KEY environment variable is required.");
  console.error("Usage: OPENAI_API_KEY=sk-... npm run demo:realistic");
  process.exit(1);
}

const baseURL = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
const studioPort = process.env.STUDIO_PORT ? Number(process.env.STUDIO_PORT) : 4400;

const memoryStore = new InMemoryMemoryStore();
const graphStore = new InMemoryGraphStore();

const world = new WorldEngine({
  worldId: scenario.name,
  maxTicks: scenario.maxTicks,
  tickIntervalMs: scenario.tickIntervalMs,
  llm: { baseURL, apiKey, model },
  rulesPath: {
    json: [join(__dirname, "rules/village-rules.json")],
  },
  memoryStore,
  graphStore,
  interaction: scenario.interaction,
});

world.use(ConsoleLoggerPlugin);

const report = reportGeneratorPlugin({ engine: world });
world.use(report.plugin);

world.use(
  studioPlugin({
    engine: world,
    port: studioPort,
    open: true,
    memoryStore,
    graphStore,
    reportGetter: () => report.getReport(),
  }),
);

if (Array.isArray(scenario.entities)) {
  for (const entity of scenario.entities) {
    world.addEntity(entity);
  }
}

for (const agent of scenario.agents) {
  world.addAgent(agent);
}

console.log("\n  Borgo Realistico — Perception Demo");
console.log(
  `  ${scenario.agents.length} agents, ${(scenario.entities ?? []).length} entities, `
  + `${scenario.maxTicks} ticks`,
);
console.log(`  Studio dashboard: http://localhost:${studioPort}`);
console.log("  Tip: open the 'Perception' panel to see what each agent is hearing.\n");

await world.start();

const data = report.getReport();
if (data) {
  console.log(`\n${"=".repeat(60)}`);
  console.log("  PERCEPTION REPORT");
  console.log(`${"=".repeat(60)}`);
  console.log(`  Duration:            ${(data.summary.durationMs / 1000).toFixed(1)}s`);
  console.log(`  Ticks:               ${data.summary.totalTicks}`);
  console.log(`  Total speaks:        ${data.metrics.totalSpeaks}`);
  console.log(`  Total observations:  ${data.metrics.totalObservations}`);
  const perception = data.metrics.perception;
  if (perception) {
    console.log("");
    console.log(`  Total stimuli:           ${perception.totalStimuli}`);
    console.log(`  Topics opened:           ${perception.totalTopics}`);
    console.log(`  Avg participants/topic:  ${perception.avgParticipantsPerTopic.toFixed(2)}`);
    console.log(`  Reply rate:              ${(perception.replyRate * 100).toFixed(0)}%`);
    console.log(`  Causal coherence:        ${(perception.causalCoherence * 100).toFixed(0)}%`);
  }
  console.log("");
  for (const agent of data.agents) {
    if (agent.role === "control") continue;
    const moodEnd = agent.moodTrajectory.at(-1)?.mood ?? "?";
    const energyEnd = agent.energyTrajectory.at(-1)?.energy ?? 0;
    const perceives = agent.actions.perceive ?? 0;
    console.log(
      `    ${agent.name.padEnd(22)} actions=${agent.totalActions}  speaks=${agent.actions.speak ?? 0}  perceive=${perceives}  mood=${moodEnd} energy=${energyEnd}`,
    );
  }
  console.log(`${"=".repeat(60)}\n`);
}

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await world.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await world.stop();
  process.exit(0);
});
