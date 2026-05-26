/**
 * Meta Ads Demo — 100 utenti reagiscono a un annuncio FitPulse Pro
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx examples/meta-ads-demo/index.ts
 *   STUDIO=1 OPENAI_API_KEY=sk-... npx tsx examples/meta-ads-demo/index.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WorldEngine,
  ConsoleLoggerPlugin,
  InMemoryMemoryStore,
  InMemoryGraphStore,
  RelationshipPlugin,
  studioPlugin,
} from "worldsim";
import { reportGeneratorPlugin } from "../../src/plugins/built-in/ReportGeneratorPlugin.js";
import { resolveLlmEnv } from "../../src/llm/resolveLlmEnv.js";
import { createMessageId } from "../../src/messaging/MessageBus.js";
import type { ReactionArchetype, SimulationReport } from "../../src/types/ReportTypes.js";
import { generateAgents, type MetaAdsScenarioConfig } from "./generate-agents.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ScenarioFile extends MetaAdsScenarioConfig {
  name: string;
  description?: string;
  maxTicks: number;
  tickIntervalMs: number;
  trigger: {
    atTick: number;
    announcement: string;
  };
  engine: {
    maxConcurrentAgents: number;
    defaultActiveTickRatio: number;
    enableResponseCache?: boolean;
    responseCacheTtl?: number;
  };
}

const scenario: ScenarioFile = JSON.parse(
  readFileSync(join(__dirname, "scenario.json"), "utf-8"),
);

const llm = resolveLlmEnv();
if (!llm) {
  console.error("Error: OPENAI_API_KEY or OPENROUTER_API_KEY is required.");
  console.error("Usage: OPENAI_API_KEY=sk-... npx tsx examples/meta-ads-demo/index.ts");
  process.exit(1);
}

const memoryStore = new InMemoryMemoryStore();
const graphStore = new InMemoryGraphStore();

const world = new WorldEngine({
  worldId: scenario.name,
  maxTicks: scenario.maxTicks,
  tickIntervalMs: scenario.tickIntervalMs,
  maxConcurrentAgents: scenario.engine.maxConcurrentAgents,
  defaultActiveTickRatio: scenario.engine.defaultActiveTickRatio,
  enableResponseCache: scenario.engine.enableResponseCache ?? true,
  responseCacheTtl: scenario.engine.responseCacheTtl ?? 5,
  llm: {
    ...llm,
    maxRetries: 3,
    retryInitialDelayMs: 500,
    retryMaxDelayMs: 8000,
    retryBackoffFactor: 2,
    maxTokens: 400,
  },
  lightLlm: {
    ...llm,
    maxTokens: 250,
    maxRetries: 3,
  },
  memoryStore,
  graphStore,
});

world.use(ConsoleLoggerPlugin);
world.use(new RelationshipPlugin({ graphStore }));

const report = reportGeneratorPlugin({ engine: world });
world.use(report.plugin);

const enableStudio = process.env.STUDIO === "1";
if (enableStudio) {
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
}

const agents = generateAgents(scenario);
for (const agent of agents) {
  world.addAgent(agent);
}

const triggerTick = scenario.trigger.atTick;
const adCopy = scenario.trigger.announcement;

world.on("tick", (tick: number) => {
  if (tick === triggerTick) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  META AD TRIGGER — Tick ${tick}`);
    console.log(`  ${adCopy.slice(0, 100)}...`);
    console.log(`${"=".repeat(60)}\n`);

    world.getMessageBus().broadcast({
      id: createMessageId(),
      from: "meta-feed",
      type: "speak",
      content: adCopy,
      tick,
    });
    report.recordPolicyTrigger(tick, adCopy);
  }
});

console.log(`\n  Meta Ads Demo — FitPulse Pro`);
console.log(`  ${agents.length} agents | ${scenario.maxTicks} ticks | Ad at tick ${triggerTick}`);
console.log(`  Model: ${llm.model}`);
if (enableStudio) {
  console.log(`  Studio dashboard: http://localhost:4400`);
}
console.log();

const startTime = Date.now();
await world.start();
const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

const data = report.getReport();
if (data) {
  printReportSummary(data, elapsedSec);

  const resultsDir = join(__dirname, "results");
  mkdirSync(resultsDir, { recursive: true });
  const outputPath = join(resultsDir, "report.json");
  writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");
  console.log(`  Full report: ${outputPath}\n`);
}

if (enableStudio) {
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await world.stop();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await world.stop();
    process.exit(0);
  });
}

function printReportSummary(data: SimulationReport, elapsedSec: string): void {
  console.log(`\n${"=".repeat(60)}`);
  console.log("  SIMULATION REPORT");
  console.log(`${"=".repeat(60)}`);
  console.log(`  Duration:      ${elapsedSec}s (engine: ${(data.summary.durationMs / 1000).toFixed(1)}s)`);
  console.log(`  Ticks:         ${data.summary.totalTicks}`);
  console.log(`  Total actions: ${data.summary.totalActions}`);
  console.log(`  Speaks:        ${data.metrics.totalSpeaks}`);
  console.log(`  Observations:  ${data.metrics.totalObservations}`);

  if (data.metrics.estimatedCost?.amount != null) {
    const { amount, currency } = data.metrics.estimatedCost;
    console.log(`  Est. cost:     ${currency} ${amount.toFixed(4)}`);
  }

  if (data.archetypes?.perAgent.length) {
    const counts: Record<ReactionArchetype, number> = {
      compliant: 0,
      skeptic: 0,
      resistant: 0,
      apathetic: 0,
    };
    for (const a of data.archetypes.perAgent) {
      counts[a.archetype]++;
    }
    const total = data.archetypes.perAgent.length;
    console.log(`\n  Archetypes (${total} agents):`);
    for (const [key, count] of Object.entries(counts)) {
      const pct = ((count / total) * 100).toFixed(0);
      console.log(`    ${key.padEnd(12)} ${String(count).padStart(3)} (${pct}%)`);
    }
  }

  if (data.shock) {
    const { pre, post, deltas } = data.shock;
    console.log(`\n  Shock analysis (trigger tick ${data.shock.triggerTick}):`);
    console.log(`    Speak rate:  ${pre.speakRate.toFixed(3)} → ${post.speakRate.toFixed(3)} (Δ ${deltas.speakRate >= 0 ? "+" : ""}${deltas.speakRate.toFixed(3)})`);
    console.log(`    Avg energy:  ${pre.avgEnergy.toFixed(1)} → ${post.avgEnergy.toFixed(1)} (Δ ${deltas.avgEnergy >= 0 ? "+" : ""}${deltas.avgEnergy.toFixed(1)})`);
    console.log(`    Mood shift:  ${deltas.moodChanged ? "yes" : "no"}`);
    if (data.shock.recoveryTicks != null) {
      console.log(`    Recovery:    ${data.shock.recoveryTicks} ticks`);
    }
  }

  if (data.network) {
    console.log(`\n  Network:`);
    console.log(`    Density:     ${data.network.density.at(-1)?.value?.toFixed(3) ?? "n/a"}`);
    console.log(`    Communities: ${data.network.communities.length}`);
  }

  console.log(`${"=".repeat(60)}`);
}
