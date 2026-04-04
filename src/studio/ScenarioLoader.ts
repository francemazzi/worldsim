import { WorldEngine } from "../engine/WorldEngine.js";
import { InMemoryMemoryStore } from "../stores/InMemoryMemoryStore.js";
import { InMemoryGraphStore } from "../stores/InMemoryGraphStore.js";
import { ConsoleLoggerPlugin } from "../plugins/built-in/ConsoleLoggerPlugin.js";
import { reportGeneratorPlugin } from "../plugins/built-in/ReportGeneratorPlugin.js";
import { RealWorldToolsPlugin, type RealWorldDataSources } from "../plugins/built-in/RealWorldToolsPlugin.js";
import { RelationshipPlugin } from "../plugins/built-in/RelationshipPlugin.js";
import { MovementPlugin } from "../plugins/built-in/MovementPlugin.js";
import { LocationIndex } from "../location/LocationIndex.js";
import type { RelationshipTypeDefinition } from "../types/GraphTypes.js";
import type { LocationConfig } from "../types/LocationTypes.js";
import type { LLMConfig } from "../types/WorldTypes.js";
import type { SimulationReport } from "../types/ReportTypes.js";

export interface ScenarioConfig {
  name: string;
  description?: string;
  maxTicks?: number;
  tickIntervalMs?: number;
  agents: ScenarioAgentConfig[];
  rules?: { json?: string[]; pdf?: string[] };
  dataSources?: RealWorldDataSources;
  trigger?: {
    atTick: number;
    addRules?: string[];
    announcement?: string;
  };
  /** Custom relationship type definitions for this scenario */
  relationshipTypes?: RelationshipTypeDefinition[];
  /** Pre-established relationships seeded at tick 0 as validated */
  initialRelationships?: Array<{
    from: string;
    to: string;
    type: string;
  }>;
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
    location?: LocationConfig;
  };
  /** Relationships declared as part of this agent's identity */
  relationships?: Array<{
    target: string;
    type: string;
    description?: string;
  }>;
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

  // Register relationship plugin (always active — provides relationship tools)
  const relationshipPlugin = new RelationshipPlugin({
    graphStore,
    customTypes: scenario.relationshipTypes,
  });
  engine.use(relationshipPlugin);

  // Register real-world tools if data sources are configured
  if (scenario.dataSources) {
    engine.use(new RealWorldToolsPlugin({ dataSources: scenario.dataSources }));
  }

  // Register movement plugin if any agent has location
  const hasLocations = scenario.agents.some((a) => a.profile?.location);
  if (hasLocations) {
    const locationIndex = new LocationIndex();
    const movementPlugin = new MovementPlugin(locationIndex);

    for (const agent of scenario.agents) {
      const loc = agent.profile?.location;
      if (loc?.current) {
        locationIndex.update(agent.id, loc.current);
      }
      if (loc?.home) {
        movementPlugin.registerHome(agent.id, loc.home);
      }
    }

    engine.use(movementPlugin);
  }

  const report = reportGeneratorPlugin({ engine });
  engine.use(report.plugin);

  for (const agent of scenario.agents) {
    engine.addAgent(agent);
  }

  // Seed initial relationships as validated (strength 0.8, status "validated")
  if (scenario.initialRelationships && scenario.initialRelationships.length > 0) {
    relationshipPlugin
      .seedRelationships(scenario.initialRelationships, graphStore)
      .catch((err) =>
        console.error("[Scenario] Failed to seed initial relationships:", err),
      );
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
