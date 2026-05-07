/**
 * Side-by-side comparison runner.
 *
 * Runs the same evaluation scenario twice — once in legacy mode and once
 * with the perception layer enabled — and prints a delta table covering
 * the metrics that move the most (replyRate, causalCoherence, silence,
 * total speaks, total tokens).
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx evaluation/compare-perception.ts village-realistic
 *
 * Note: each invocation hits the LLM twice — costs roughly 2× a single
 * scenario run.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runScenario,
  SCENARIO_NAMES,
  PERCEPTION_SCENARIOS,
} from "./run-evaluation.js";
import type { SimulationReport } from "../src/types/ReportTypes.js";
import { computePerceptionInsights } from "../src/analysis/narrative.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RESULTS_DIR = resolve(__dirname, "results");

type ScenarioName = (typeof SCENARIO_NAMES)[number];

function readReport(filename: string): SimulationReport | null {
  try {
    const path = join(RESULTS_DIR, filename);
    return JSON.parse(readFileSync(path, "utf-8")) as SimulationReport;
  } catch {
    return null;
  }
}

interface Row {
  metric: string;
  legacy: string;
  perception: string;
  delta: string;
}

function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function buildDeltaTable(
  legacy: SimulationReport,
  perception: SimulationReport,
): Row[] {
  const lp = legacy.metrics.perception;
  const pp = perception.metrics.perception;
  const legacyInsights = computePerceptionInsights(legacy);
  const perceptionInsights = computePerceptionInsights(perception);

  return [
    {
      metric: "Total speaks",
      legacy: String(legacy.metrics.totalSpeaks),
      perception: String(perception.metrics.totalSpeaks),
      delta: String(perception.metrics.totalSpeaks - legacy.metrics.totalSpeaks),
    },
    {
      metric: "Total tokens",
      legacy: String(legacy.metrics.totalTokens),
      perception: String(perception.metrics.totalTokens),
      delta: String(perception.metrics.totalTokens - legacy.metrics.totalTokens),
    },
    {
      metric: "Reply rate",
      legacy: lp ? fmtPct(lp.replyRate) : "n/a",
      perception: pp ? fmtPct(pp.replyRate) : "n/a",
      delta: lp && pp ? fmtPct(pp.replyRate - lp.replyRate) : "—",
    },
    {
      metric: "Causal coherence",
      legacy: lp ? fmtPct(lp.causalCoherence) : "n/a",
      perception: pp ? fmtPct(pp.causalCoherence) : "n/a",
      delta: lp && pp ? fmtPct(pp.causalCoherence - lp.causalCoherence) : "—",
    },
    {
      metric: "Silence ratio",
      legacy: legacyInsights ? fmtPct(legacyInsights.silenceRatio) : "n/a",
      perception: perceptionInsights ? fmtPct(perceptionInsights.silenceRatio) : "n/a",
      delta:
        legacyInsights && perceptionInsights
          ? fmtPct(perceptionInsights.silenceRatio - legacyInsights.silenceRatio)
          : "—",
    },
    {
      metric: "Avg participants/topic",
      legacy: lp ? fmtNum(lp.avgParticipantsPerTopic) : "n/a",
      perception: pp ? fmtNum(pp.avgParticipantsPerTopic) : "n/a",
      delta:
        lp && pp ? fmtNum(pp.avgParticipantsPerTopic - lp.avgParticipantsPerTopic) : "—",
    },
  ];
}

function printTable(rows: Row[]): void {
  const headers = ["Metric", "Legacy", "Perception", "Delta"];
  const widths = headers.map((h, i) => {
    const colValues = [h, ...rows.map((r) => Object.values(r)[i] ?? "")];
    return Math.max(...colValues.map((s) => String(s).length));
  });
  const fmtRow = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join("  ");
  console.log("\n" + fmtRow(headers));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) {
    console.log(fmtRow([r.metric, r.legacy, r.perception, r.delta]));
  }
  console.log();
}

async function main(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "Error: OPENAI_API_KEY environment variable is required.\n" +
        "Usage: OPENAI_API_KEY=sk-... npx tsx evaluation/compare-perception.ts <scenario>",
    );
    process.exit(1);
  }

  const requested = process.argv[2] ?? "village-realistic";
  if (!(SCENARIO_NAMES as readonly string[]).includes(requested)) {
    console.error(
      `Unknown scenario: "${requested}"\nAvailable: ${SCENARIO_NAMES.join(", ")}`,
    );
    process.exit(1);
  }
  const scenarioName = requested as ScenarioName;
  if (!PERCEPTION_SCENARIOS.has(scenarioName)) {
    console.warn(
      `Warning: scenario "${scenarioName}" was not authored for the perception layer. The diff may be uninformative.`,
    );
  }

  console.log(`\n  WorldSim — Legacy vs Perception comparison`);
  console.log(`  Scenario: ${scenarioName}`);
  console.log(`  Each side runs the LLM independently — expect ~2x the cost of a single run.`);

  // Legacy run: explicit override regardless of what the scenario JSON says.
  await runScenario(scenarioName, {
    interaction: { mode: "legacy" },
    outputName: `${scenarioName}-legacy`,
    silent: true,
  });

  // Perception run: keep whatever the scenario authored. For non-perception
  // scenarios we still flip to perception mode with sensible defaults.
  const scenarioRaw = JSON.parse(
    readFileSync(
      resolve(__dirname, "scenarios", scenarioName, "scenario.json"),
      "utf-8",
    ),
  ) as { interaction?: { mode?: string } };
  const perceptionInteraction =
    scenarioRaw.interaction?.mode === "perception"
      ? undefined
      : ({
          mode: "perception",
          disableBroadcastFallback: true,
          defaultSenses: [
            { channel: "sound", radiusKm: 0.05 },
            { channel: "language", languages: ["it"] },
          ],
        } as const);

  await runScenario(scenarioName, {
    ...(perceptionInteraction ? { interaction: perceptionInteraction } : {}),
    outputName: `${scenarioName}-perception`,
    silent: true,
  });

  const legacyReport = readReport(`${scenarioName}-legacy.json`);
  const perceptionReport = readReport(`${scenarioName}-perception.json`);

  if (!legacyReport || !perceptionReport) {
    console.error("Could not read one of the result files; aborting comparison.");
    process.exit(1);
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  COMPARISON: ${scenarioName}`);
  console.log(`${"=".repeat(70)}`);
  printTable(buildDeltaTable(legacyReport, perceptionReport));
  console.log(
    "  Reading the diff: in perception mode you should see fewer total speaks\n" +
      "  but a higher causalCoherence — agents stay quieter and on topic.",
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
