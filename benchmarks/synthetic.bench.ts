import { bench, describe } from "vitest";
import { createBenchEngine, formatMs, formatMB } from "./helpers.js";
import { LocationIndex } from "../src/location/LocationIndex.js";
import { PerceptionEngine } from "../src/perception/PerceptionEngine.js";
import { StimulusBus } from "../src/perception/StimulusBus.js";
import type { Stimulus } from "../src/types/StimulusTypes.js";

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

function createPerceptionBench(agentCount: number): {
  engine: PerceptionEngine;
  bus: StimulusBus;
} {
  const idx = new LocationIndex();
  const engine = new PerceptionEngine({ locationIndex: idx });
  const bus = new StimulusBus();
  bus.newTick(1);

  for (let i = 0; i < agentCount; i++) {
    const id = `agent-${i}`;
    idx.update(id, {
      latitude: 45 + (i % 20) * 0.00005,
      longitude: 9 + Math.floor(i / 20) * 0.00005,
    });
    engine.registerAgent(id, [{ channel: "sound", radiusKm: 0.2 }]);
  }

  for (let i = 0; i < agentCount; i++) {
    const stim: Stimulus = {
      id: `bench-stim-${agentCount}-${i}`,
      kind: "speech",
      channel: "sound",
      source: { kind: "agent", id: `agent-${i}` },
      tick: 1,
      intensity: 0.8,
      payload: { text: "benchmark" },
    };
    bus.publish(stim);
  }

  return { engine, bus };
}

describe("PerceptionEngine Micro Benchmark", () => {
  const perception100 = createPerceptionBench(100);
  const perception500 = createPerceptionBench(500);

  bench(
    "perceiveAll: 100 agents / 100 stimuli",
    () => {
      perception100.engine.perceiveAll(perception100.bus, 1);
    },
    { iterations: 20, warmupIterations: 5 },
  );

  bench(
    "perceiveFor: 100 agents / 100 stimuli",
    () => {
      for (let i = 0; i < 100; i++) {
        perception100.engine.perceiveFor(`agent-${i}`, perception100.bus, 1);
      }
    },
    { iterations: 20, warmupIterations: 5 },
  );

  bench(
    "perceiveAll: 500 agents / 500 stimuli",
    () => {
      perception500.engine.perceiveAll(perception500.bus, 1);
    },
    { iterations: 10, warmupIterations: 2 },
  );

  bench(
    "perceiveFor: 500 agents / 500 stimuli",
    () => {
      for (let i = 0; i < 500; i++) {
        perception500.engine.perceiveFor(`agent-${i}`, perception500.bus, 1);
      }
    },
    { iterations: 10, warmupIterations: 2 },
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
