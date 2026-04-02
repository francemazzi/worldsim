/**
 * Standalone benchmark runner.
 * Runs synthetic + optional E2E benchmarks and prints a full report.
 *
 * Usage:
 *   npx tsx benchmarks/run.ts              # synthetic only
 *   npx tsx benchmarks/run.ts --e2e        # synthetic + E2E (requires .env)
 */

import {
  createBenchEngine,
  InstrumentedLLMAdapter,
  formatMs,
  formatMB,
  formatTokens,
  formatCost,
  percentile,
  avg,
  type BenchEngineOptions,
} from "./helpers.js";

interface SyntheticResult {
  scenario: string;
  agents: number;
  ticks: number;
  tickAvgMs: number;
  actionsPerTick: number;
  llmCalls: number;
  maxConcurrent: number;
  rssDeltaMB: number;
}

async function runSyntheticScenario(
  scenario: string,
  opts: BenchEngineOptions,
): Promise<SyntheticResult> {
  const rssBefore = process.memoryUsage().rss;
  const { engine, llm } = createBenchEngine(opts);

  const tickTimes: number[] = [];
  let tickStart = 0;
  engine.on("tick", () => {
    const now = performance.now();
    if (tickStart > 0) tickTimes.push(now - tickStart);
    tickStart = now;
  });

  const start = performance.now();
  await engine.start();
  const totalMs = performance.now() - start;

  const rssAfter = process.memoryUsage().rss;
  const events = engine.getEventLog();
  const actions = events.filter((e) => e.type === "action:executed");

  return {
    scenario,
    agents: opts.agents,
    ticks: opts.ticks,
    tickAvgMs: tickTimes.length > 0
      ? tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length
      : totalMs / opts.ticks,
    actionsPerTick: Math.round(actions.length / opts.ticks),
    llmCalls: llm.callCount,
    maxConcurrent: llm.maxConcurrent,
    rssDeltaMB: (rssAfter - rssBefore) / 1024 / 1024,
  };
}

const SYNTHETIC_SCENARIOS: Array<{ name: string; opts: BenchEngineOptions }> = [
  {
    name: "baseline-100",
    opts: { agents: 100, ticks: 3 },
  },
  {
    name: "capped-100",
    opts: { agents: 100, ticks: 3, maxConcurrent: 20 },
  },
  {
    name: "neighborhood-100",
    opts: { agents: 100, ticks: 3, maxConcurrent: 20, neighborhood: true },
  },
  {
    name: "scheduled-500",
    opts: { agents: 500, ticks: 3, maxConcurrent: 50, neighborhood: true, schedule: true },
  },
  {
    name: "full-1000",
    opts: { agents: 1000, ticks: 3, maxConcurrent: 50, neighborhood: true, schedule: true },
  },
];

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}
function padLeft(s: string, len: number): string {
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

function printSyntheticTable(results: SyntheticResult[]): void {
  console.log("\nSYNTHETIC BENCHMARK (mock LLM, 5ms delay)");
  console.log("─".repeat(85));
  console.log(
    `  ${padRight("Scenario", 20)} ${padLeft("Agents", 7)} ${padLeft("Tick avg", 10)} ${padLeft("Acts/tick", 10)} ${padLeft("LLM calls", 10)} ${padLeft("Max conc", 10)} ${padLeft("RSS Δ", 10)}`,
  );
  console.log("─".repeat(85));

  for (const r of results) {
    console.log(
      `  ${padRight(r.scenario, 20)} ${padLeft(String(r.agents), 7)} ${padLeft(formatMs(r.tickAvgMs), 10)} ${padLeft(String(r.actionsPerTick), 10)} ${padLeft(String(r.llmCalls), 10)} ${padLeft(String(r.maxConcurrent), 10)} ${padLeft(`+${r.rssDeltaMB.toFixed(1)}MB`, 10)}`,
    );
  }
  console.log("─".repeat(85));
}

async function runE2E(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log("\nE2E BENCHMARK: Skipped (no OPENAI_API_KEY in environment)");
    return;
  }

  const { OpenAICompatAdapter } = await import("../src/llm/OpenAICompatAdapter.js");
  const { WorldEngine } = await import("../src/engine/WorldEngine.js");
  const { InMemoryMemoryStore } = await import("../tests/helpers/InMemoryMemoryStore.js");
  const { InMemoryGraphStore } = await import("../tests/helpers/InMemoryGraphStore.js");

  const baseURL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  const model = process.env.BENCH_MODEL ?? "gpt-4o-mini";

  console.log(`\nE2E BENCHMARK (${model}, real LLM)`);
  console.log("─".repeat(85));

  const scenarios = [
    { name: "small-5", agents: 5, ticks: 3 },
    { name: "medium-10", agents: 10, ticks: 3 },
  ];

  for (const s of scenarios) {
    const realLLM = new OpenAICompatAdapter({ baseURL, apiKey, model });
    const instrumented = new InstrumentedLLMAdapter(realLLM);

    const engine = new WorldEngine({
      worldId: `e2e-report-${s.agents}`,
      maxTicks: s.ticks,
      tickIntervalMs: 0,
      maxConcurrentAgents: 5,
      llm: { baseURL, apiKey, model },
      memoryStore: new InMemoryMemoryStore(),
      graphStore: new InMemoryGraphStore(),
    });

    // @ts-expect-error Accessing private for benchmark
    engine.llmPool = {
      getAdapter: () => instrumented,
      getWorldAdapter: () => instrumented,
      clear: () => {},
    };

    for (let i = 0; i < s.agents; i++) {
      engine.addAgent({
        id: `p-${i}`,
        role: "person",
        name: `P${i}`,
        iterationsPerTick: 1,
        profile: {
          name: `Persona ${i}`,
          personality: ["curiosa"],
          goals: ["conversare"],
        },
      });
    }

    console.log(`  Running ${s.name} (${s.agents} agents, ${s.ticks} ticks)...`);
    await engine.start();

    const st = instrumented.stats;
    const totalTokens = st.totalInputTokens + st.totalOutputTokens;
    console.log(
      `  ${padRight(s.name, 16)} agents=${s.agents}  tokens=${formatTokens(totalTokens)}  cost=${formatCost(st.totalInputTokens, st.totalOutputTokens)}  avg_lat=${formatMs(avg(st.latencies))}  p95=${formatMs(percentile(st.latencies, 95))}  json_ok=${Math.round((st.validJsonCount / Math.max(1, st.calls)) * 100)}%`,
    );
  }

  console.log("─".repeat(85));
}

// ─── Main ───

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════╗");
  console.log("║    WorldSim Benchmark Report         ║");
  console.log("╚══════════════════════════════════════╝");

  // Synthetic
  const results: SyntheticResult[] = [];
  for (const s of SYNTHETIC_SCENARIOS) {
    process.stdout.write(`  Running ${s.name}...`);
    const result = await runSyntheticScenario(s.name, s.opts);
    results.push(result);
    console.log(` done (${formatMs(result.tickAvgMs)}/tick)`);
  }
  printSyntheticTable(results);

  // E2E (optional)
  if (process.argv.includes("--e2e")) {
    await runE2E();
  } else {
    console.log("\nE2E BENCHMARK: Skipped (pass --e2e to enable)");
  }
}

main().catch(console.error);
