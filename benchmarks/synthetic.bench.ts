import { bench, describe } from "vitest";
import { createBenchEngine, formatMs, formatMB } from "./helpers.js";

describe("WorldSim Synthetic Benchmark", () => {
  bench(
    "100 agents, unlimited concurrency, 3 ticks",
    async () => {
      const { engine } = createBenchEngine({
        agents: 100,
        ticks: 3,
        maxConcurrent: undefined,
      });
      await engine.start();
    },
    { iterations: 3, warmupIterations: 1 },
  );

  bench(
    "100 agents, capped 20 concurrency, 3 ticks",
    async () => {
      const { engine } = createBenchEngine({
        agents: 100,
        ticks: 3,
        maxConcurrent: 20,
      });
      await engine.start();
    },
    { iterations: 3, warmupIterations: 1 },
  );

  bench(
    "100 agents, capped 20, neighborhood, 3 ticks",
    async () => {
      const { engine } = createBenchEngine({
        agents: 100,
        ticks: 3,
        maxConcurrent: 20,
        neighborhood: true,
      });
      await engine.start();
    },
    { iterations: 3, warmupIterations: 1 },
  );

  bench(
    "500 agents, capped 50, neighborhood + schedule, 3 ticks",
    async () => {
      const { engine } = createBenchEngine({
        agents: 500,
        ticks: 3,
        maxConcurrent: 50,
        neighborhood: true,
        schedule: true,
      });
      await engine.start();
    },
    { iterations: 2, warmupIterations: 1 },
  );

  bench(
    "1000 agents, capped 50, neighborhood + schedule, 3 ticks",
    async () => {
      const { engine } = createBenchEngine({
        agents: 1000,
        ticks: 3,
        maxConcurrent: 50,
        neighborhood: true,
        schedule: true,
      });
      await engine.start();
    },
    { iterations: 2, warmupIterations: 1 },
  );
});

// Detailed stats benchmark — runs once, prints metrics
describe("Detailed Stats", () => {
  bench(
    "1000 agents detailed",
    async () => {
      const rssBefore = process.memoryUsage().rss;
      const { engine, llm } = createBenchEngine({
        agents: 1000,
        ticks: 3,
        maxConcurrent: 50,
        neighborhood: true,
        schedule: true,
      });

      const tickTimes: number[] = [];
      let tickStart = 0;
      engine.on("tick", () => {
        const now = performance.now();
        if (tickStart > 0) tickTimes.push(now - tickStart);
        tickStart = now;
      });

      await engine.start();

      const rssAfter = process.memoryUsage().rss;
      const events = engine.getEventLog();
      const actions = events.filter((e) => e.type === "action:executed");

      console.log("\n┌─── 1000 Agents Detailed Stats ───┐");
      console.log(`│ LLM calls:      ${llm.callCount}`);
      console.log(`│ Max concurrent:  ${llm.maxConcurrent}`);
      console.log(`│ Actions/tick:    ${Math.round(actions.length / 3)}`);
      console.log(`│ Tick avg:        ${formatMs(tickTimes.length > 0 ? tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length : 0)}`);
      console.log(`│ RSS delta:       +${formatMB(rssAfter - rssBefore)}`);
      console.log("└──────────────────────────────────┘\n");
    },
    { iterations: 1, warmupIterations: 0 },
  );
});
