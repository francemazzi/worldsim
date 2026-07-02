import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { config } from "dotenv";
import {
  buildEmergenceChartData,
  loadMicroScenario,
  resolveEmergenceModels,
  runWorld,
  type EmergenceChartData,
  type EmergenceCondition,
} from "../tests/integration/helpers/emergenceStudyHarness.js";

config({ path: ".env" });

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEFAULT_JSON = join(ROOT, "docs/public/emergence-m2-example.json");
const DEFAULT_SVG = join(ROOT, "docs/public/emergence-m2-example.svg");
const DEFAULT_PNG = join(ROOT, "docs/public/emergence-m2-example.png");

const SERIES_COLORS: Record<string, string> = {
  homogeneous_a: "#2563eb",
  homogeneous_b: "#dc2626",
  mixed: "#7c3aed",
};

const SERIES_LABELS: Record<string, string> = {
  homogeneous_a: "Homogeneous A",
  homogeneous_b: "Homogeneous B",
  mixed: "Mixed",
};

const CONDITIONS: EmergenceCondition[] = [
  "homogeneous_a",
  "homogeneous_b",
  "mixed",
];

export function renderEmergenceChartSvg(data: EmergenceChartData): string {
  const width = 760;
  const height = 420;
  const titleY = 22;
  const legendY = 48;
  const margin = { top: 80, right: 24, bottom: 64, left: 64 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const maxTick = data.meta.maxTicks;
  const maxY = Math.max(
    1,
    ...data.series.flatMap((series) => series.points.map((point) => point.cumulative)),
  );

  const xScale = (tick: number) =>
    margin.left + ((tick - 1) / Math.max(maxTick - 1, 1)) * plotWidth;
  const yScale = (value: number) =>
    margin.top + plotHeight - (value / maxY) * plotHeight;

  const yTicks = Array.from({ length: maxY + 1 }, (_, index) => index);
  const xTicks = Array.from({ length: maxTick }, (_, index) => index + 1);

  const gridLines = yTicks
    .map((tick) => {
      const y = yScale(tick);
      return `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1" />`;
    })
    .join("\n");

  const axisYLabels = yTicks
    .map((tick) => {
      const y = yScale(tick);
      return `<text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#4b5563">${tick}</text>`;
    })
    .join("\n");

  const axisXLabels = xTicks
    .map((tick) => {
      const x = xScale(tick);
      return `<text x="${x}" y="${height - margin.bottom + 24}" text-anchor="middle" font-size="12" fill="#4b5563">${tick}</text>`;
    })
    .join("\n");

  const seriesLines = data.series
    .map((series) => {
      const points = series.points
        .map((point) => `${xScale(point.tick)},${yScale(point.cumulative)}`)
        .join(" ");
      const color = SERIES_COLORS[series.condition] ?? "#111827";
      return `<polyline fill="none" stroke="${color}" stroke-width="2.5" points="${points}" />`;
    })
    .join("\n");

  const seriesMarkers = data.series
    .flatMap((series) => {
      const color = SERIES_COLORS[series.condition] ?? "#111827";
      return series.points.map(
        (point) =>
          `<circle cx="${xScale(point.tick)}" cy="${yScale(point.cumulative)}" r="3.5" fill="${color}" />`,
      );
    })
    .join("\n");

  const legend = data.series
    .map((series, index) => {
      const color = SERIES_COLORS[series.condition] ?? "#111827";
      const label = SERIES_LABELS[series.condition] ?? series.condition;
      const x = margin.left + index * 220;
      return `
        <rect x="${x}" y="${legendY - 10}" width="14" height="14" fill="${color}" rx="2" />
        <text x="${x + 20}" y="${legendY + 1}" font-size="13" fill="#111827">${label}</text>
        <text x="${x + 20}" y="${legendY + 16}" font-size="11" fill="#6b7280">${series.label}</text>
      `;
    })
    .join("\n");

  const triggerLine =
    data.meta.triggerTick != null
      ? (() => {
          const x = xScale(data.meta.triggerTick);
          return `
            <line x1="${x}" y1="${margin.top}" x2="${x}" y2="${height - margin.bottom}" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="5 4" />
            <text x="${x + 6}" y="${margin.top + 14}" font-size="11" fill="#6b7280">Resource shock (tick ${data.meta.triggerTick})</text>
          `;
        })()
      : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative governance blocks across three model conditions">
  <rect width="100%" height="100%" fill="#ffffff" />
  <text x="${width / 2}" y="${titleY}" text-anchor="middle" font-size="16" font-weight="600" fill="#111827">Cumulative governance blocks (M2 proxy)</text>
  ${legend}
  ${gridLines}
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#374151" stroke-width="1.5" />
  <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#374151" stroke-width="1.5" />
  ${axisYLabels}
  ${axisXLabels}
  <text x="${margin.left + plotWidth / 2}" y="${height - 12}" text-anchor="middle" font-size="13" fill="#374151">Simulation tick</text>
  <text x="18" y="${margin.top + plotHeight / 2}" text-anchor="middle" font-size="13" fill="#374151" transform="rotate(-90 18 ${margin.top + plotHeight / 2})">Cumulative blocked actions</text>
  ${triggerLine}
  ${seriesLines}
  ${seriesMarkers}
</svg>`;
}

function renderEmergenceChartPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 760 },
  });
  return Buffer.from(resvg.render().asPng());
}

function writeChartAssets(
  data: EmergenceChartData,
  jsonPath: string,
  svgPath: string,
  pngPath: string,
): void {
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
  const svg = renderEmergenceChartSvg(data);
  writeFileSync(svgPath, svg, "utf-8");
  writeFileSync(pngPath, renderEmergenceChartPng(svg));
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${svgPath}`);
  console.log(`Wrote ${pngPath}`);
}

async function runLiveStudy(
  jsonPath: string,
  svgPath: string,
  pngPath: string,
): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required for --run");
  }

  const models = resolveEmergenceModels();
  const scenario = loadMicroScenario();
  console.log(
    `Running Emergence micro-study (${models.modelA} vs ${models.modelB}, ${models.maxTicks} ticks)...`,
  );

  const results = [];
  for (const condition of CONDITIONS) {
    console.log(`  -> ${condition}`);
    results.push(await runWorld(condition, { models, scenario }));
  }

  const data = buildEmergenceChartData(results, {
    models,
    triggerTick: scenario.trigger?.atTick ?? null,
  });

  writeChartAssets(data, jsonPath, svgPath, pngPath);
}

function renderFromJson(jsonPath: string, svgPath: string, pngPath: string): void {
  const raw = readFileSync(jsonPath, "utf-8");
  const data = JSON.parse(raw) as EmergenceChartData;
  writeChartAssets(data, jsonPath, svgPath, pngPath);
  console.log(`Rendered ${svgPath} and ${pngPath} from ${jsonPath}`);
}

function parseArgs(argv: string[]): {
  run: boolean;
  jsonPath: string;
  svgPath: string;
  pngPath: string;
} {
  const run = argv.includes("--run");
  const fromIndex = argv.indexOf("--from");
  const jsonPath =
    fromIndex >= 0 && argv[fromIndex + 1]
      ? argv[fromIndex + 1]!
      : DEFAULT_JSON;
  const svgIndex = argv.indexOf("--svg");
  const svgPath =
    svgIndex >= 0 && argv[svgIndex + 1]
      ? argv[svgIndex + 1]!
      : DEFAULT_SVG;
  const pngIndex = argv.indexOf("--png");
  const pngPath =
    pngIndex >= 0 && argv[pngIndex + 1]
      ? argv[pngIndex + 1]!
      : DEFAULT_PNG;

  return { run, jsonPath, svgPath, pngPath };
}

async function main(): Promise<void> {
  const { run, jsonPath, svgPath, pngPath } = parseArgs(process.argv.slice(2));

  if (run) {
    await runLiveStudy(jsonPath, svgPath, pngPath);
    return;
  }

  renderFromJson(jsonPath, svgPath, pngPath);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
