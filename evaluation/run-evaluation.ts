/**
 * WorldSim Evaluation Runner
 *
 * Runs the 3 evaluation scenarios (water-rationing, price-shock, rumor-spread)
 * using WorldEngine + ReportGeneratorPlugin and writes results to evaluation/results/.
 *
 * Usage:
 *   npx tsx evaluation/run-evaluation.ts                  # Run all scenarios
 *   npx tsx evaluation/run-evaluation.ts water-rationing   # Run a single scenario
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WorldEngine,
  ConsoleLoggerPlugin,
  InMemoryMemoryStore,
  InMemoryGraphStore,
} from "worldsim";
import { reportGeneratorPlugin } from "../src/plugins/built-in/ReportGeneratorPlugin.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SCENARIOS_DIR = resolve(__dirname, "scenarios");
const RESULTS_DIR = resolve(__dirname, "results");

const SCENARIO_NAMES = ["water-rationing", "price-shock", "rumor-spread"] as const;
type ScenarioName = (typeof SCENARIO_NAMES)[number];

// ---------------------------------------------------------------------------
// Types (matching ScenarioLoader.ScenarioConfig shape)
// ---------------------------------------------------------------------------

interface ScenarioAgentConfig {
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

interface ScenarioConfig {
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadScenarioFile(scenarioName: string): ScenarioConfig {
  const scenarioPath = join(SCENARIOS_DIR, scenarioName, "scenario.json");
  if (!existsSync(scenarioPath)) {
    throw new Error(`Scenario file not found: ${scenarioPath}`);
  }
  return JSON.parse(readFileSync(scenarioPath, "utf-8")) as ScenarioConfig;
}

function resolveRulePaths(
  scenarioName: string,
  scenario: ScenarioConfig,
): { json?: string[]; pdf?: string[] } {
  const scenarioDir = join(SCENARIOS_DIR, scenarioName);

  // Collect all rule paths: base rules (from rules/ directory) + trigger rules
  const jsonPaths: string[] = [];

  // Always load community/market rules from the rules/ directory
  const rulesDir = join(scenarioDir, "rules");
  if (existsSync(rulesDir)) {
    const baseRuleFiles: Record<string, string> = {
      "water-rationing": "community-rules.json",
      "price-shock": "market-rules.json",
      "rumor-spread": "community-rules.json",
    };
    const baseRule = baseRuleFiles[scenarioName];
    if (baseRule) {
      const baseRulePath = join(rulesDir, baseRule);
      if (existsSync(baseRulePath)) {
        jsonPaths.push(baseRulePath);
      }
    }
  }

  return jsonPaths.length > 0 ? { json: jsonPaths } : {};
}

function resolveTriggerRulePaths(
  scenarioName: string,
  trigger: ScenarioConfig["trigger"],
): string[] | undefined {
  if (!trigger?.addRules) return undefined;
  const scenarioDir = join(SCENARIOS_DIR, scenarioName);
  return trigger.addRules.map((rulePath) => resolve(scenarioDir, rulePath));
}

// ---------------------------------------------------------------------------
// Run a single scenario
// ---------------------------------------------------------------------------

async function runScenario(scenarioName: string): Promise<void> {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  SCENARIO: ${scenarioName}`);
  console.log(`${"=".repeat(70)}\n`);

  const scenario = loadScenarioFile(scenarioName);
  const rulesPath = resolveRulePaths(scenarioName, scenario);

  console.log(`  Name:    ${scenario.name}`);
  console.log(`  Agents:  ${scenario.agents.length}`);
  console.log(`  Ticks:   ${scenario.maxTicks ?? 30}`);
  if (scenario.trigger) {
    console.log(`  Trigger: tick ${scenario.trigger.atTick}`);
  }
  console.log();

  // Create stores
  const memoryStore = new InMemoryMemoryStore();
  const graphStore = new InMemoryGraphStore();

  // Create engine
  const engine = new WorldEngine({
    worldId: scenario.name,
    maxTicks: scenario.maxTicks ?? 30,
    tickIntervalMs: scenario.tickIntervalMs ?? 2000,
    llm: {
      baseURL: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY!,
      model: process.env.LLM_MODEL ?? "gpt-4o-mini",
    },
    rulesPath: Object.keys(rulesPath).length > 0 ? rulesPath : undefined,
    memoryStore,
    graphStore,
  });

  // Register plugins
  engine.use(ConsoleLoggerPlugin);

  const report = reportGeneratorPlugin({ engine });
  engine.use(report.plugin);

  // Add agents
  for (const agent of scenario.agents) {
    engine.addAgent(agent);
  }

  // Set up trigger if defined
  if (scenario.trigger) {
    const triggerTick = scenario.trigger.atTick;
    const announcement = scenario.trigger.announcement;
    const triggerRulePaths = resolveTriggerRulePaths(scenarioName, scenario.trigger);

    engine.on("tick", (tick: number) => {
      if (tick === triggerTick) {
        if (announcement) {
          console.log(
            `\n  [Trigger] Tick ${tick}: ${announcement.slice(0, 100)}...`,
          );
        }
        if (triggerRulePaths) {
          console.log(
            `  [Trigger] Loading rules: ${triggerRulePaths.map((p) => p.split("/").pop()).join(", ")}`,
          );
        }
      }
    });
  }

  // Run simulation
  const startTime = Date.now();
  console.log(`  Starting simulation...\n`);

  await engine.start();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Collect report
  const reportData = report.getReport();

  if (reportData) {
    // Ensure results directory exists
    mkdirSync(RESULTS_DIR, { recursive: true });

    const outputPath = join(RESULTS_DIR, `${scenarioName}.json`);
    writeFileSync(outputPath, JSON.stringify(reportData, null, 2), "utf-8");

    console.log(`\n  ${"—".repeat(50)}`);
    console.log(`  RESULTS: ${scenarioName}`);
    console.log(`  ${"—".repeat(50)}`);
    console.log(`  Duration:      ${elapsed}s`);
    console.log(`  Total ticks:   ${reportData.summary.totalTicks}`);
    console.log(`  Total actions: ${reportData.summary.totalActions}`);
    console.log(`  Total events:  ${reportData.summary.totalEvents}`);
    console.log(`  Agents:        ${reportData.summary.agentCount}`);
    console.log();
    console.log(`  Per-agent actions:`);
    for (const agentReport of reportData.agents) {
      const { name, role, totalActions, actions } = agentReport;
      console.log(
        `    ${name} (${role}): ${totalActions} actions — speak: ${actions.speak}, observe: ${actions.observe}, interact: ${actions.interact}, tool: ${actions.tool_call}`,
      );
    }
    console.log();
    console.log(`  Report written to: ${outputPath}`);
  } else {
    console.log(`\n  WARNING: No report generated for ${scenarioName}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Check for API key
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "Error: OPENAI_API_KEY environment variable is required.\n" +
        "Usage: OPENAI_API_KEY=sk-... npx tsx evaluation/run-evaluation.ts",
    );
    process.exit(1);
  }

  // Parse CLI args
  const args = process.argv.slice(2);
  let scenariosToRun: string[];

  if (args.length > 0) {
    const requested = args[0];
    if (!SCENARIO_NAMES.includes(requested as ScenarioName)) {
      console.error(
        `Unknown scenario: "${requested}"\nAvailable: ${SCENARIO_NAMES.join(", ")}`,
      );
      process.exit(1);
    }
    scenariosToRun = [requested];
  } else {
    scenariosToRun = [...SCENARIO_NAMES];
  }

  console.log(`\n  WorldSim Evaluation Runner`);
  console.log(`  Model: ${process.env.LLM_MODEL ?? "gpt-4o-mini"}`);
  console.log(`  Scenarios: ${scenariosToRun.join(", ")}`);

  // Run scenarios sequentially
  for (const name of scenariosToRun) {
    await runScenario(name);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  All evaluations complete.`);
  console.log(`  Results in: ${RESULTS_DIR}`);
  console.log(`${"=".repeat(70)}\n`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
