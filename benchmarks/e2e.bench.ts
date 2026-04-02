import { bench, describe } from "vitest";
import { WorldEngine } from "../src/engine/WorldEngine.js";
import { OpenAICompatAdapter } from "../src/llm/OpenAICompatAdapter.js";
import {
  InstrumentedLLMAdapter,
  formatMs,
  formatTokens,
  formatCost,
  percentile,
  avg,
} from "./helpers.js";
import { InMemoryMemoryStore } from "../tests/helpers/InMemoryMemoryStore.js";
import { InMemoryGraphStore } from "../tests/helpers/InMemoryGraphStore.js";

const apiKey = process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
const model = process.env.BENCH_MODEL ?? "gpt-4o-mini";

function createE2EEngine(
  agents: number,
  ticks: number,
  instrumented: InstrumentedLLMAdapter,
  opts?: { neighborhood?: boolean },
): WorldEngine {
  const engine = new WorldEngine({
    worldId: `e2e-bench-${agents}-${Date.now()}`,
    maxTicks: ticks,
    tickIntervalMs: 0,
    maxConcurrentAgents: 5,
    llm: { baseURL, apiKey: apiKey!, model },
    memoryStore: new InMemoryMemoryStore(),
    graphStore: new InMemoryGraphStore(),
  });

  // Replace LLM pool with instrumented adapter
  // @ts-expect-error Accessing private field for benchmark
  engine.llmPool = {
    getAdapter: () => instrumented,
    getWorldAdapter: () => instrumented,
    clear: () => {},
  };

  for (let i = 0; i < agents; i++) {
    engine.addAgent({
      id: `person-${i}`,
      role: "person",
      name: `Persona ${i}`,
      iterationsPerTick: 1,
      profile: {
        name: `Persona ${i}`,
        personality: ["curiosa", "socievole"],
        goals: ["conversare con gli altri"],
      },
      ...(opts?.neighborhood
        ? { neighborhood: { maxContacts: 5, groups: [`group-${i % 3}`] } }
        : {}),
    });
  }

  return engine;
}

function printReport(label: string, agents: number, ticks: number, instrumented: InstrumentedLLMAdapter): void {
  const s = instrumented.stats;
  const totalTokens = s.totalInputTokens + s.totalOutputTokens;

  console.log(`\n┌─── E2E: ${label} ───┐`);
  console.log(`│ Agents:          ${agents}`);
  console.log(`│ Ticks:           ${ticks}`);
  console.log(`│ LLM calls:       ${s.calls}`);
  console.log(`│ Total tokens:    ${formatTokens(totalTokens)} (in: ${formatTokens(s.totalInputTokens)}, out: ${formatTokens(s.totalOutputTokens)})`);
  console.log(`│ Cost estimate:   ${formatCost(s.totalInputTokens, s.totalOutputTokens)}`);
  console.log(`│ Avg latency:     ${formatMs(avg(s.latencies))}`);
  console.log(`│ P95 latency:     ${formatMs(percentile(s.latencies, 95))}`);
  console.log(`│ Valid JSON:      ${s.validJsonCount}/${s.calls} (${Math.round((s.validJsonCount / Math.max(1, s.calls)) * 100)}%)`);
  console.log("└──────────────────────────────┘\n");
}

describe.skipIf(!apiKey)("WorldSim E2E Benchmark", () => {
  bench(
    "5 agents, 3 ticks",
    async () => {
      const realLLM = new OpenAICompatAdapter({ baseURL, apiKey: apiKey!, model });
      const instrumented = new InstrumentedLLMAdapter(realLLM);
      const engine = createE2EEngine(5, 3, instrumented);
      await engine.start();
      printReport("5 agents, 3 ticks", 5, 3, instrumented);
    },
    { iterations: 1, warmupIterations: 0, timeout: 120_000 },
  );

  bench(
    "10 agents, 3 ticks",
    async () => {
      const realLLM = new OpenAICompatAdapter({ baseURL, apiKey: apiKey!, model });
      const instrumented = new InstrumentedLLMAdapter(realLLM);
      const engine = createE2EEngine(10, 3, instrumented);
      await engine.start();
      printReport("10 agents, 3 ticks", 10, 3, instrumented);
    },
    { iterations: 1, warmupIterations: 0, timeout: 180_000 },
  );

  bench(
    "20 agents, neighborhood, 3 ticks",
    async () => {
      const realLLM = new OpenAICompatAdapter({ baseURL, apiKey: apiKey!, model });
      const instrumented = new InstrumentedLLMAdapter(realLLM);
      const engine = createE2EEngine(20, 3, instrumented, { neighborhood: true });
      await engine.start();
      printReport("20 agents, neighborhood, 3 ticks", 20, 3, instrumented);
    },
    { iterations: 1, warmupIterations: 0, timeout: 300_000 },
  );
});
