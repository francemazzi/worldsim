import { parseArgs } from "node:util";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { StudioServer } from "../studio/StudioServer.js";

const HELP = `
WorldSim CLI

Commands:
  studio    Launch the WorldSim Studio dashboard

Options:
  --port, -p <number>     Port for the Studio server (default: 4400)
  --config, -c <path>     Path to worldsim.studio.json config file
  --no-open               Don't auto-open browser
  --help, -h              Show this help message

Usage:
  npx worldsim studio
  npx worldsim studio --port 5000
  npx worldsim studio --config ./worldsim.studio.json

Note: For live mode (with a running simulation), use the studioPlugin()
in your code instead:

  import { studioPlugin } from "worldsim";
  engine.use(studioPlugin({ engine, port: 4400 }));
`.trim();

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      port: { type: "string", short: "p" },
      config: { type: "string", short: "c" },
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

  if (command !== "studio") {
    console.error(`Unknown command: ${command}`);
    console.log(HELP);
    process.exit(1);
  }

  // Load config if provided
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
  console.log(`[WorldSim Studio] No live engine connected. REST API available for store queries.`);

  const server = new StudioServer({
    port,
  });

  await server.start();
  const url = `http://localhost:${port}`;
  console.log(`[WorldSim Studio] Dashboard ready at ${url}`);

  if (shouldOpen) {
    const { exec } = await import("node:child_process");
    const { platform } = await import("node:os");
    const cmd =
      platform() === "darwin"
        ? `open "${url}"`
        : platform() === "win32"
          ? `start "${url}"`
          : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }

  // Keep process alive
  process.on("SIGINT", async () => {
    console.log("\n[WorldSim Studio] Shutting down...");
    await server.close();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await server.close();
    process.exit(0);
  });
}

function findConfig(): string | null {
  const candidates = [
    "worldsim.studio.json",
    ".worldsim-studio.json",
  ];
  for (const candidate of candidates) {
    if (existsSync(resolve(candidate))) return resolve(candidate);
  }
  return null;
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
