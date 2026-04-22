import type { SimulationReport } from "../types/ReportTypes.js";
import { toCsv, type CsvRow } from "./csv.js";

export type ExportDataset =
  | "timeline"
  | "centrality"
  | "speakMatrix"
  | "voice"
  | "responseRate"
  | "shock"
  | "archetypes"
  | "relationships"
  | "moodVariance"
  | "agents";

const DATASETS: ExportDataset[] = [
  "timeline",
  "centrality",
  "speakMatrix",
  "voice",
  "responseRate",
  "shock",
  "archetypes",
  "relationships",
  "moodVariance",
  "agents",
];

export function isExportDataset(value: string | undefined): value is ExportDataset {
  return !!value && (DATASETS as string[]).includes(value);
}

export function listDatasets(): ExportDataset[] {
  return [...DATASETS];
}

export function exportDataset(
  report: SimulationReport,
  dataset: ExportDataset,
): string {
  switch (dataset) {
    case "timeline":
      return toCsv(
        report.timeline.map<CsvRow>((t) => ({
          tick: t.tick,
          type: t.type,
          agentId: t.agentId ?? "",
          description: t.description,
        })),
      );
    case "centrality":
      return toCsv(
        (report.network?.centrality ?? []).map<CsvRow>((c) => ({ ...c })),
      );
    case "speakMatrix":
      return toCsv(
        (report.dialogue?.speakMatrix ?? []).map<CsvRow>((e) => ({ ...e })),
      );
    case "voice":
      return toCsv(
        (report.dialogue?.voiceByAgent ?? []).map<CsvRow>((v) => ({ ...v })),
      );
    case "responseRate":
      return toCsv(
        (report.dialogue?.responseRate ?? []).map<CsvRow>((r) => ({ ...r })),
      );
    case "shock": {
      const s = report.shock;
      if (!s) return toCsv([]);
      const rows: CsvRow[] = [
        { metric: "avgMood", pre: s.pre.avgMood, post: s.post.avgMood, delta: s.deltas.moodChanged ? "changed" : "stable" },
        { metric: "avgEnergy", pre: s.pre.avgEnergy, post: s.post.avgEnergy, delta: s.deltas.avgEnergy },
        { metric: "speakRate", pre: s.pre.speakRate, post: s.post.speakRate, delta: s.deltas.speakRate },
        { metric: "violationRate", pre: s.pre.violationRate, post: s.post.violationRate, delta: s.deltas.violationRate },
        { metric: "toolCallRate", pre: s.pre.toolCallRate, post: s.post.toolCallRate, delta: s.deltas.toolCallRate },
        { metric: "recoveryTicks", pre: "", post: "", delta: s.recoveryTicks ?? "" },
      ];
      return toCsv(rows, ["metric", "pre", "post", "delta"]);
    }
    case "archetypes":
      return toCsv(
        (report.archetypes?.perAgent ?? []).map<CsvRow>((a) => ({
          agentId: a.agentId,
          archetype: a.archetype,
          score: a.score,
          compliant: a.subScores.compliant,
          skeptic: a.subScores.skeptic,
          resistant: a.subScores.resistant,
          apathetic: a.subScores.apathetic,
          rationale: a.rationale,
        })),
      );
    case "relationships":
      return toCsv(
        report.relationships.map<CsvRow>((r) => ({
          from: r.from,
          to: r.to,
          type: r.type,
          initialStrength: r.initialStrength,
          finalStrength: r.finalStrength,
          delta: r.delta,
          snapshotCount: r.snapshots.length,
        })),
      );
    case "moodVariance":
      return toCsv(
        (report.archetypes?.moodVarianceByTick ?? []).map<CsvRow>((p) => ({ ...p })),
      );
    case "agents":
      return toCsv(
        report.agents.map<CsvRow>((a) => ({
          agentId: a.agentId,
          name: a.name,
          role: a.role,
          personality: a.personality.join("|"),
          totalActions: a.totalActions,
          speak: a.actions.speak,
          observe: a.actions.observe,
          interact: a.actions.interact,
          tool_call: a.actions.tool_call,
          finish: a.actions.finish,
          statusChanges: a.statusChanges.length,
        })),
      );
  }
}
