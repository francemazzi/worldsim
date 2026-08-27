import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WorldEngine,
  InMemoryMemoryStore,
  InMemoryGraphStore,
} from "../../../src/index.js";
import type { AgentConfig } from "../../../src/types/AgentTypes.js";
import type { LLMConfig, WorldEvent } from "../../../src/types/WorldTypes.js";
import type { SimulationReport } from "../../../src/types/ReportTypes.js";
import { resolveLlmEnv } from "../../../src/llm/resolveLlmEnv.js";
import { reportGeneratorPlugin } from "../../../src/plugins/built-in/ReportGeneratorPlugin.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURE_DIR = join(__dirname, "..", "..", "fixtures", "emergence-micro");

export type EmergenceCondition = "homogeneous_a" | "homogeneous_b" | "mixed";

export interface EmergenceModels {
  modelA: string;
  modelB: string;
  maxTicks: number;
  maxConcurrent: number;
}

export interface EmergenceScenario {
  name: string;
  description?: string;
  maxTicks?: number;
  tickIntervalMs?: number;
  agents: AgentConfig[];
  trigger?: {
    atTick: number;
    addRules?: string[];
    announcement?: string;
  };
}

export interface AwiLiteMetrics {
  condition: EmergenceCondition;
  modelLabel: string;
  m1PopulationAlive: number;
  m2RuleViolations: number;
  m3GovernanceEvents: {
    allowed: number;
    warned: number;
    blocked: number;
  };
  m6TotalSpeaks: number;
  m7RelationshipCount: number;
  m7NetworkDensity: number | null;
  totalActions: number;
  totalTicks: number;
}

export interface EmergenceRunResult {
  condition: EmergenceCondition;
  report: SimulationReport;
  eventLog: WorldEvent[];
  awiLite: AwiLiteMetrics;
}

export interface EmergenceChartPoint {
  tick: number;
  cumulative: number;
}

export interface EmergenceChartSeries {
  condition: EmergenceCondition;
  label: string;
  points: EmergenceChartPoint[];
}

export interface EmergenceChartData {
  meta: {
    generatedAt: string;
    modelA: string;
    modelB: string;
    maxTicks: number;
    triggerTick: number | null;
    metric: "governance_blocks";
    disclaimer: string;
  };
  series: EmergenceChartSeries[];
}

const CHART_DISCLAIMER =
  "Illustrative micro-replica (4 agents, 8 ticks, single run). Not equivalent to the 15-day Emergence World study.";

const DEFAULT_MODEL_A = "google/gemini-2.5-flash";
const DEFAULT_MODEL_B = "anthropic/claude-3-haiku";

export function resolveEmergenceModels(): EmergenceModels {
  return {
    modelA: process.env.EMERGENCE_MODEL_A ?? DEFAULT_MODEL_A,
    modelB: process.env.EMERGENCE_MODEL_B ?? DEFAULT_MODEL_B,
    maxTicks: parseInt(process.env.EMERGENCE_MAX_TICKS ?? "8", 10),
    maxConcurrent: parseInt(process.env.EMERGENCE_MAX_CONCURRENT ?? "2", 10),
  };
}

export function loadMicroScenario(): EmergenceScenario {
  const scenarioPath = join(FIXTURE_DIR, "scenario.json");
  return JSON.parse(readFileSync(scenarioPath, "utf-8")) as EmergenceScenario;
}

function resolveBaseLlmConfig(): LLMConfig {
  const base = resolveLlmEnv();
  if (!base) {
    throw new Error("OPENROUTER_API_KEY is required for Emergence micro-study integration tests");
  }

  return {
    ...base,
    temperature: 0.3,
    maxTokens: 300,
    maxRetries: 3,
    retryInitialDelayMs: 500,
    retryMaxDelayMs: 8000,
    retryBackoffFactor: 2,
  };
}

function modelForPersonAgent(
  agentId: string,
  condition: EmergenceCondition,
  models: EmergenceModels,
  baseLlm: LLMConfig,
): Partial<LLMConfig> | undefined {
  if (condition === "homogeneous_a") {
    return { ...baseLlm, model: models.modelA };
  }
  if (condition === "homogeneous_b") {
    return { ...baseLlm, model: models.modelB };
  }

  const modelAAgents = new Set(["scientist", "community_anchor"]);
  const model = modelAAgents.has(agentId) ? models.modelA : models.modelB;
  return { ...baseLlm, model };
}

function modelLabelForCondition(
  condition: EmergenceCondition,
  models: EmergenceModels,
): string {
  switch (condition) {
    case "homogeneous_a":
      return models.modelA;
    case "homogeneous_b":
      return models.modelB;
    case "mixed":
      return `${models.modelA} + ${models.modelB}`;
  }
}

export function buildWorld(
  condition: EmergenceCondition,
  options?: { models?: EmergenceModels; scenario?: EmergenceScenario },
): {
  engine: WorldEngine;
  reportHandle: ReturnType<typeof reportGeneratorPlugin>;
} {
  const models = options?.models ?? resolveEmergenceModels();
  const scenario = options?.scenario ?? loadMicroScenario();
  const baseLlm = resolveBaseLlmConfig();
  const constitutionPath = join(FIXTURE_DIR, "rules", "constitution.json");
  const maxTicks = models.maxTicks;

  const memoryStore = new InMemoryMemoryStore();
  const graphStore = new InMemoryGraphStore();

  const engine = new WorldEngine({
    worldId: `emergence-micro-${condition}`,
    maxTicks,
    tickIntervalMs: scenario.tickIntervalMs ?? 0,
    maxConcurrentAgents: models.maxConcurrent,
    llm: baseLlm,
    rulesPath: { json: [constitutionPath] },
    memoryStore,
    graphStore,
  });

  const reportHandle = reportGeneratorPlugin({ engine });
  engine.use(reportHandle.plugin);

  for (const agent of scenario.agents) {
    if (agent.role === "person") {
      engine.addAgent({
        ...agent,
        llm: modelForPersonAgent(agent.id, condition, models, baseLlm),
      });
    } else {
      engine.addAgent(agent);
    }
  }

  const triggerTick = scenario.trigger?.atTick;
  const announcement = scenario.trigger?.announcement;

  if (triggerTick != null) {
    engine.on("tick", (tick: number) => {
      if (tick === triggerTick && announcement) {
        reportHandle.recordPolicyTrigger(tick, announcement);
      }
    });
  }

  return { engine, reportHandle };
}

export async function runWorld(
  condition: EmergenceCondition,
  options?: { models?: EmergenceModels; scenario?: EmergenceScenario },
): Promise<EmergenceRunResult> {
  const models = options?.models ?? resolveEmergenceModels();
  const { engine, reportHandle } = buildWorld(condition, options);

  await engine.start();

  const report = reportHandle.getReport();
  if (!report) {
    throw new Error(`No report produced for condition ${condition}`);
  }

  const eventLog = engine.getEventLog();
  const awiLite = computeAwiLite(condition, report, eventLog, models);

  return { condition, report, eventLog, awiLite };
}

export function computeAwiLite(
  condition: EmergenceCondition,
  report: SimulationReport,
  eventLog: WorldEvent[],
  models: EmergenceModels = resolveEmergenceModels(),
): AwiLiteMetrics {
  const personAgents = report.agents.filter((a) => a.role === "person");
  const alivePersonAgents = personAgents.filter((a) => {
    const lastStatus = a.statusChanges.at(-1);
    return lastStatus?.to !== "stopped";
  });

  const governanceEvents = {
    allowed: 0,
    warned: 0,
    blocked: 0,
  };

  for (const event of eventLog) {
    if (event.type === "action:allowed") governanceEvents.allowed += 1;
    if (event.type === "action:warned") governanceEvents.warned += 1;
    if (event.type === "action:blocked") governanceEvents.blocked += 1;
  }

  const densityPoints = report.network?.density ?? [];
  const finalDensity =
    densityPoints.length > 0 ? densityPoints.at(-1)!.density : null;

  return {
    condition,
    modelLabel: modelLabelForCondition(condition, models),
    m1PopulationAlive: alivePersonAgents.length,
    m2RuleViolations: report.metrics.ruleViolations,
    m3GovernanceEvents: governanceEvents,
    m6TotalSpeaks: report.metrics.totalSpeaks,
    m7RelationshipCount: report.relationships.length,
    m7NetworkDensity: finalDensity,
    totalActions: report.summary.totalActions,
    totalTicks: report.summary.totalTicks,
  };
}

export function formatAwiLiteTable(rows: AwiLiteMetrics[]): string {
  const header = [
    "Condition",
    "Model(s)",
    "M1 Alive",
    "M2 Violations",
    "M3 Gov (a/w/b)",
    "M6 Speaks",
    "M7 Rels",
    "Actions",
  ].join("\t");

  const lines = rows.map((row) =>
    [
      row.condition,
      row.modelLabel,
      row.m1PopulationAlive,
      row.m2RuleViolations,
      `${row.m3GovernanceEvents.allowed}/${row.m3GovernanceEvents.warned}/${row.m3GovernanceEvents.blocked}`,
      row.m6TotalSpeaks,
      row.m7RelationshipCount,
      row.totalActions,
    ].join("\t"),
  );

  return [header, ...lines].join("\n");
}

export function resolveOpenRouterLlmConfig(): LLMConfig {
  return resolveBaseLlmConfig();
}

export function extractBlockedActionsByTick(
  eventLog: WorldEvent[],
  maxTicks: number,
): number[] {
  const byTick = Array.from({ length: maxTicks }, () => 0);
  for (const event of eventLog) {
    if (event.type !== "action:blocked") continue;
    if (event.tick < 1 || event.tick > maxTicks) continue;
    byTick[event.tick - 1] += 1;
  }
  return byTick;
}

export function toCumulativeSeries(byTick: number[]): number[] {
  let running = 0;
  return byTick.map((count) => {
    running += count;
    return running;
  });
}

export function buildEmergenceChartSeries(
  result: EmergenceRunResult,
  models: EmergenceModels = resolveEmergenceModels(),
): EmergenceChartSeries {
  const maxTicks = result.report.summary.totalTicks;
  const byTick = extractBlockedActionsByTick(result.eventLog, maxTicks);
  const cumulative = toCumulativeSeries(byTick);

  return {
    condition: result.condition,
    label: modelLabelForCondition(result.condition, models),
    points: cumulative.map((value, index) => ({
      tick: index + 1,
      cumulative: value,
    })),
  };
}

export function buildEmergenceChartData(
  results: EmergenceRunResult[],
  options?: {
    models?: EmergenceModels;
    triggerTick?: number | null;
    generatedAt?: string;
  },
): EmergenceChartData {
  const models = options?.models ?? resolveEmergenceModels();
  const maxTicks = results[0]?.report.summary.totalTicks ?? models.maxTicks;

  return {
    meta: {
      generatedAt: options?.generatedAt ?? new Date().toISOString(),
      modelA: models.modelA,
      modelB: models.modelB,
      maxTicks,
      triggerTick: options?.triggerTick ?? loadMicroScenario().trigger?.atTick ?? null,
      metric: "governance_blocks",
      disclaimer: CHART_DISCLAIMER,
    },
    series: results.map((result) => buildEmergenceChartSeries(result, models)),
  };
}
