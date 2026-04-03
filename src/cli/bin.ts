import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { StudioServer } from "../studio/StudioServer.js";
import { loadScenario } from "../studio/ScenarioLoader.js";
import { studioPlugin } from "../studio/StudioPlugin.js";
import { LifeSkillsPlugin } from "../plugins/built-in/LifeSkillsPlugin.js";

const HELP = `
WorldSim CLI

Commands:
  studio    Launch the WorldSim Studio dashboard (post-mortem mode)
  demo      Run the built-in community simulation demo with Studio

Options:
  --port, -p <number>     Port for the Studio server (default: 4400)
  --config, -c <path>     Path to worldsim.studio.json config file
  --model, -m <string>    LLM model name (default: gpt-4o-mini)
  --base-url <string>     LLM base URL (default: https://api.openai.com/v1)
  --no-open               Don't auto-open browser
  --help, -h              Show this help message

Usage:
  npx worldsim demo                              # Run the Villaggio del Sole demo
  npx worldsim demo --model gpt-4o              # Use a specific model
  npx worldsim studio                            # Dashboard in post-mortem mode
  npx worldsim studio --port 5000

Environment:
  OPENAI_API_KEY    Required for the demo command
  LLM_BASE_URL      Override LLM endpoint
  LLM_MODEL         Override model name
`.trim();

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: "string", short: "p" },
      config: { type: "string", short: "c" },
      model: { type: "string", short: "m" },
      "base-url": { type: "string" },
      open: { type: "boolean", default: true },
      "no-open": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help || positionals.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const command = positionals[0];

  if (command === "demo") {
    await runDemo(values);
  } else if (command === "studio") {
    await runStudio(values);
  } else {
    console.error(`Unknown command: ${command}`);
    console.log(HELP);
    process.exit(1);
  }
}

async function runDemo(values: Record<string, unknown>): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("Error: OPENAI_API_KEY environment variable is required for the demo.");
    console.error("Usage: OPENAI_API_KEY=sk-... npx worldsim demo");
    process.exit(1);
  }

  const port = values.port ? parseInt(values.port as string, 10) : 4400;
  const shouldOpen = !values["no-open"];
  const model = (values.model as string) ?? process.env.LLM_MODEL ?? "gpt-4o-mini";
  const baseURL = (values["base-url"] as string) ?? process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";

  // Load bundled demo scenario
  let currentDir: string;
  try {
    currentDir = typeof __dirname !== "undefined" ? __dirname : dirname(fileURLToPath(import.meta.url));
  } catch {
    currentDir = process.cwd();
  }

  // Try multiple paths for the scenario (dev vs npm install)
  const scenarioPaths = [
    join(currentDir, "..", "..", "examples", "community-demo", "scenario.json"),
    join(currentDir, "..", "examples", "community-demo", "scenario.json"),
    join(process.cwd(), "examples", "community-demo", "scenario.json"),
  ];

  let scenarioPath: string | null = null;
  for (const p of scenarioPaths) {
    if (existsSync(p)) {
      scenarioPath = p;
      break;
    }
  }

  if (!scenarioPath) {
    console.error("Error: Could not find the community-demo scenario.");
    console.error("Searched:", scenarioPaths.join(", "));
    process.exit(1);
  }

  const scenario = JSON.parse(readFileSync(scenarioPath, "utf-8"));

  console.log(`\n  Villaggio del Sole — Community Policy Simulation`);
  console.log(`  ${scenario.agents.length} agents | ${scenario.maxTicks} ticks`);
  console.log(`  Model: ${model}`);

  const result = loadScenario(scenario, { baseURL, apiKey, model });

  result.engine.use(
    new LifeSkillsPlugin(["farming", "cooking", "social", "technology", "crafting", "spiritual", "academic"]),
  );

  result.engine.use(
    studioPlugin({
      engine: result.engine,
      port,
      open: shouldOpen,
      memoryStore: result.memoryStore,
      graphStore: result.graphStore,
      reportGetter: () => result.getReport(),
    }),
  );

  console.log(`  Studio dashboard: http://localhost:${port}\n`);

  await result.engine.start();

  // Print report
  const data = result.getReport();
  if (data) {
    console.log(`\n  Simulation complete: ${data.summary.totalActions} actions in ${(data.summary.durationMs / 1000).toFixed(1)}s`);
  }

  // Keep alive for Studio
  setupShutdown(async () => {
    await result.engine.stop();
  });
}

async function runStudio(values: Record<string, unknown>): Promise<void> {
  let config: Record<string, unknown> = {};
  const configPath = (values.config as string) ?? findConfig();
  if (configPath && existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(resolve(configPath), "utf-8"));
      console.log(`[WorldSim Studio] Loaded config from ${configPath}`);
    } catch (err) {
      console.error(`Failed to parse config: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  const port = values.port
    ? parseInt(values.port as string, 10)
    : (config.port as number) ?? 4400;

  const shouldOpen = !values["no-open"];

  console.log(`[WorldSim Studio] Starting in post-mortem mode...`);

  const server = new StudioServer({ port });

  await server.start();
  const url = `http://localhost:${port}`;
  console.log(`[WorldSim Studio] Dashboard ready at ${url}`);

  if (shouldOpen) {
    openBrowser(url);
  }

  setupShutdown(async () => {
    await server.close();
  });
}

function setupShutdown(cleanup: () => Promise<void>): void {
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await cleanup();
    process.exit(0);
  });
}

function openBrowser(url: string): void {
  import("node:child_process").then(({ exec }) => {
    import("node:os").then(({ platform }) => {
      const cmd =
        platform() === "darwin"
          ? `open "${url}"`
          : platform() === "win32"
            ? `start "${url}"`
            : `xdg-open "${url}"`;
      exec(cmd, () => {});
    });
  });
}

function findConfig(): string | null {
  const candidates = ["worldsim.studio.json", ".worldsim-studio.json"];
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate))) return resolve(candidate);
  }
  return null;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
