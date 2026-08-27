import type { EmergenceChartData } from "../tests/integration/helpers/emergenceStudyHarness.js";

const SERIES_COLORS: Record<string, string> = {
  homogeneous_a: "#2563eb",
  homogeneous_b: "#dc2626",
  mixed: "#7c3aed",
};

const SERIES_LABELS: Record<string, string> = {
  homogeneous_a: "Homogeneous A",
  homogeneous_b: "Homogeneous B",
  mixed: "Mixed population",
};

const PERSON_AGENTS = [
  { id: "scientist", name: "Dr. Chen", role: "Scientist" },
  { id: "community_anchor", name: "Morgan", role: "Community anchor" },
  { id: "conflict_mediator", name: "Jordan", role: "Conflict mediator" },
  { id: "resource_strategist", name: "Alex", role: "Resource strategist" },
];

function escapeSvg(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortModel(model: string): string {
  const parts = model.split("/");
  return parts.length > 1 ? parts[parts.length - 1]! : model;
}

function modelBadge(model: string, color: string, x: number, y: number): string {
  const label = escapeSvg(shortModel(model));
  const width = Math.max(72, label.length * 6.2 + 16);
  return `
    <rect x="${x}" y="${y}" width="${width}" height="18" rx="9" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="1" />
    <text x="${x + width / 2}" y="${y + 13}" text-anchor="middle" font-size="10" fill="${color}">${label}</text>
  `;
}

function renderWorldBox(
  condition: keyof typeof SERIES_COLORS,
  modelA: string,
  modelB: string,
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  const color = SERIES_COLORS[condition] ?? "#111827";
  const title = SERIES_LABELS[condition] ?? condition;
  const subtitle =
    condition === "homogeneous_a"
      ? "All person agents use model A"
      : condition === "homogeneous_b"
        ? "All person agents use model B"
        : "Two agents per vendor";

  const agentLines = PERSON_AGENTS.map((agent, index) => {
    const agentY = y + 74 + index * 22;
    const agentModel =
      condition === "homogeneous_a"
        ? modelA
        : condition === "homogeneous_b"
          ? modelB
          : agent.id === "scientist" || agent.id === "community_anchor"
            ? modelA
            : modelB;
    const badgeColor =
      agentModel === modelA ? SERIES_COLORS.homogeneous_a : SERIES_COLORS.homogeneous_b;

    return `
      <text x="${x + 14}" y="${agentY}" font-size="11" fill="#111827">${escapeSvg(agent.name)}</text>
      <text x="${x + 14}" y="${agentY + 12}" font-size="9" fill="#6b7280">${escapeSvg(agent.role)}</text>
      ${modelBadge(agentModel, badgeColor, x + width - 92, agentY - 11)}
    `;
  }).join("\n");

  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="10" fill="#ffffff" stroke="${color}" stroke-width="2" />
    <rect x="${x}" y="${y}" width="${width}" height="34" rx="10" fill="${color}" fill-opacity="0.08" />
    <rect x="${x}" y="${y + 24}" width="${width}" height="10" fill="${color}" fill-opacity="0.08" />
    <text x="${x + 14}" y="${y + 22}" font-size="13" font-weight="600" fill="${color}">${escapeSvg(title)}</text>
    <text x="${x + 14}" y="${y + 48}" font-size="10" fill="#4b5563">${escapeSvg(subtitle)}</text>
    <line x1="${x + 12}" y1="${y + 58}" x2="${x + width - 12}" y2="${y + 58}" stroke="#e5e7eb" stroke-width="1" />
    ${agentLines}
    <text x="${x + 14}" y="${y + height - 12}" font-size="10" fill="#6b7280">+ Governance monitor (control agent)</text>
  `;
}

function arrow(x1: number, y1: number, x2: number, y2: number): string {
  return `
    <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#9ca3af" stroke-width="1.5" marker-end="url(#arrowhead)" />
  `;
}

export function renderEmergenceStudyOverviewSvg(data: EmergenceChartData): string {
  const width = 760;
  const height = 520;
  const { modelA, modelB, maxTicks, triggerTick } = data.meta;

  const sharedBox = { x: 40, y: 54, w: 680, h: 88 };
  const worldY = 196;
  const worldW = 210;
  const worldH = 196;
  const worldXs = [40, 275, 510];
  const outputBox = { x: 130, y: 438, w: 500, h: 58 };

  const worldBoxes = [
    renderWorldBox("homogeneous_a", modelA, modelB, worldXs[0]!, worldY, worldW, worldH),
    renderWorldBox("homogeneous_b", modelA, modelB, worldXs[1]!, worldY, worldW, worldH),
    renderWorldBox("mixed", modelA, modelB, worldXs[2]!, worldY, worldW, worldH),
  ].join("\n");

  const fanOutArrows = worldXs
    .map((worldX) =>
      arrow(
        sharedBox.x + sharedBox.w / 2,
        sharedBox.y + sharedBox.h,
        worldX + worldW / 2,
        worldY,
      ),
    )
    .join("\n");

  const mergeArrows = worldXs
    .map((worldX) =>
      arrow(
        worldX + worldW / 2,
        worldY + worldH,
        outputBox.x + outputBox.w / 2,
        outputBox.y,
      ),
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="How the Emergence micro-study works in WorldSim">
  <defs>
    <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
      <polygon points="0 0, 8 4, 0 8" fill="#9ca3af" />
    </marker>
  </defs>
  <rect width="100%" height="100%" fill="#ffffff" />
  <text x="${width / 2}" y="28" text-anchor="middle" font-size="16" font-weight="600" fill="#111827">How the Emergence micro-study works</text>
  <text x="${width / 2}" y="46" text-anchor="middle" font-size="11" fill="#6b7280">Same scenario and rules, three LLM assignment conditions, compare safety metrics</text>

  <rect x="${sharedBox.x}" y="${sharedBox.y}" width="${sharedBox.w}" height="${sharedBox.h}" rx="10" fill="#f9fafb" stroke="#d1d5db" stroke-width="1.5" />
  <text x="${sharedBox.x + 16}" y="${sharedBox.y + 22}" font-size="12" font-weight="600" fill="#111827">Shared identical setup</text>
  <text x="${sharedBox.x + 16}" y="${sharedBox.y + 42}" font-size="11" fill="#374151">4 person agents + governance monitor · constitutional rules from tick 1</text>
  <text x="${sharedBox.x + 16}" y="${sharedBox.y + 58}" font-size="11" fill="#374151">Resource shock + rationing rules at tick ${triggerTick ?? 4} · ${maxTicks} simulation ticks via OpenRouter</text>
  <text x="${sharedBox.x + 16}" y="${sharedBox.y + 74}" font-size="10" fill="#6b7280">Models: A = ${escapeSvg(modelA)} · B = ${escapeSvg(modelB)}</text>

  ${fanOutArrows}
  ${worldBoxes}
  ${mergeArrows}

  <rect x="${outputBox.x}" y="${outputBox.y}" width="${outputBox.w}" height="${outputBox.h}" rx="10" fill="#ecfdf5" stroke="#10b981" stroke-width="1.5" />
  <text x="${outputBox.x + outputBox.w / 2}" y="${outputBox.y + 24}" text-anchor="middle" font-size="12" font-weight="600" fill="#047857">Compare AWI-lite metrics across conditions</text>
  <text x="${outputBox.x + outputBox.w / 2}" y="${outputBox.y + 42}" text-anchor="middle" font-size="11" fill="#065f46">Population, governance blocks (M2), speaks, relationships — plotted below as cumulative blocks</text>
</svg>`;
}
