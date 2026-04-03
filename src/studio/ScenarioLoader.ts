import { WorldEngine } from "../engine/WorldEngine.js";
import { InMemoryMemoryStore } from "../stores/InMemoryMemoryStore.js";
import { InMemoryGraphStore } from "../stores/InMemoryGraphStore.js";
import { ConsoleLoggerPlugin } from "../plugins/built-in/ConsoleLoggerPlugin.js";
import { reportGeneratorPlugin } from "../plugins/built-in/ReportGeneratorPlugin.js";
import type { LLMConfig } from "../types/WorldTypes.js";
import type { SimulationReport } from "../types/ReportTypes.js";

export interface ScenarioConfig {
  name: string;
  description?: string;
  maxTicks?: number;
  tickIntervalMs?: number;
  agents: ScenarioAgentConfig[];
  rules?: { json?: string[]; pdf?: string[] };
  trigger?: {
    atTick: number;
    addRules?: string[];
    announcement?: string;
  };
}

export interface ScenarioAgentConfig {
  id: string;
  role: "person" | "control";
  name: string;
  iterationsPerTick?: number;
  systemPrompt?: string;
  profile?: {
    name: string;
    age?: number;
    profession?: string;
    personality: string[];
    goals: string[];
    backstory?: string;
    skills?: string[];
  };
}

export interface ScenarioResult {
  engine: WorldEngine;
  getReport: () => SimulationReport | null;
  memoryStore: InMemoryMemoryStore;
  graphStore: InMemoryGraphStore;
}

/**
 * Creates a WorldEngine from a declarative scenario configuration.
 */
export function loadScenario(
  scenario: ScenarioConfig,
  llmConfig: LLMConfig,
): ScenarioResult {
  const memoryStore = new InMemoryMemoryStore();
  const graphStore = new InMemoryGraphStore();

  const engine = new WorldEngine({
    worldId: scenario.name,
    maxTicks: scenario.maxTicks ?? 30,
    tickIntervalMs: scenario.tickIntervalMs ?? 2000,
    llm: llmConfig,
    rulesPath: scenario.rules,
    memoryStore,
    graphStore,
  });

  engine.use(ConsoleLoggerPlugin);

  const report = reportGeneratorPlugin({ engine });
  engine.use(report.plugin);

  for (const agent of scenario.agents) {
    engine.addAgent(agent);
  }

  // Set up trigger if defined
  if (scenario.trigger) {
    const triggerTick = scenario.trigger.atTick;
    const announcement = scenario.trigger.announcement;
    engine.on("tick", (tick: number) => {
      if (tick === triggerTick && announcement) {
        console.log(`[Scenario] Policy trigger at tick ${tick}: ${announcement.slice(0, 80)}...`);
      }
    });
  }

  return {
    engine,
    getReport: () => report.getReport(),
    memoryStore,
    graphStore,
  };
}
