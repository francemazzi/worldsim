import type { StudioRouter } from "../StudioRouter.js";
import { json, readBody } from "../StudioRouter.js";
import type { SimulationReport, TopicInsight } from "../../types/ReportTypes.js";
import type { MultiWorldRegistry } from "../MultiWorldRegistry.js";
import { OpenAICompatAdapter } from "../../llm/OpenAICompatAdapter.js";

export function registerReportApi(
  router: StudioRouter,
  getReport: () => SimulationReport | null,
  registry?: MultiWorldRegistry,
): void {
  router.get("/api/report", async (_req, res) => {
    const report = getReport();
    if (!report) {
      json(res, { ready: false, message: "Simulation still running or no report available." }, 202);
      return;
    }
    json(res, report);
  });

  router.get("/api/worlds", async (_req, res) => {
    if (!registry) {
      json(res, { worlds: [] });
      return;
    }
    json(res, { worlds: registry.listWorlds(), runs: registry.listRuns() });
  });

  router.get("/api/worlds/:worldId/report/live", async (_req, res, params) => {
    if (!registry) {
      json(res, { error: "Multi-world mode not enabled" }, 400);
      return;
    }
    const worldId = params.worldId;
    if (!worldId) {
      json(res, { error: "Missing world id" }, 400);
      return;
    }
    const live = registry.getLiveReport(worldId);
    if (!live) {
      json(res, { ready: false, message: `World '${worldId}' is not active.` }, 404);
      return;
    }
    json(res, live);
  });

  router.get("/api/worlds/:worldId/reports", async (_req, res, params) => {
    if (!registry) {
      json(res, { error: "Multi-world mode not enabled" }, 400);
      return;
    }
    const worldId = params.worldId;
    if (!worldId) {
      json(res, { error: "Missing world id" }, 400);
      return;
    }
    json(res, { runs: registry.listRuns(worldId) });
  });

  router.get("/api/reports/compare", async (_req, res, _params, query) => {
    if (!registry) {
      json(res, { error: "Multi-world mode not enabled" }, 400);
      return;
    }
    const runIds = extractRunIds(query.runId);
    if (runIds.length !== 2) {
      json(res, { error: "Provide exactly 2 runId query values" }, 400);
      return;
    }
    const data = registry.compareRuns(runIds[0]!, runIds[1]!);
    if (!data) {
      json(res, { error: "Unable to compare runs" }, 404);
      return;
    }
    json(res, data);
  });

  router.get("/api/reports/:runId", async (_req, res, params) => {
    if (!registry) {
      json(res, { error: "Multi-world mode not enabled" }, 400);
      return;
    }
    const runId = params.runId;
    if (!runId) {
      json(res, { error: "Missing run id" }, 400);
      return;
    }
    const report = registry.getRunReport(runId);
    if (!report) {
      json(res, { error: "Run report not found" }, 404);
      return;
    }
    const topics = registry.getRunTopics(runId);
    json(res, { runId, report, topics: topics?.topics ?? null, topicsUpdatedAt: topics?.updatedAt });
  });

  router.post("/api/reports/:runId/topics", async (req, res, params) => {
    if (!registry) {
      json(res, { error: "Multi-world mode not enabled" }, 400);
      return;
    }
    const runId = params.runId;
    if (!runId) {
      json(res, { error: "Missing run id" }, 400);
      return;
    }
    const body = (await readBody(req).catch(() => ({}))) as { forceRefresh?: boolean };
    const cached = registry.getRunTopics(runId);
    if (cached && !body.forceRefresh) {
      json(res, { runId, topics: cached.topics, cached: true, updatedAt: cached.updatedAt });
      return;
    }

    const report = registry.getRunReport(runId);
    if (!report) {
      json(res, { error: "Run report not found" }, 404);
      return;
    }

    const topics = await analyzeTopics(report);
    registry.setRunTopics(runId, topics);
    json(res, { runId, topics, cached: false, updatedAt: new Date().toISOString() });
  });
}

function extractRunIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

async function analyzeTopics(report: SimulationReport): Promise<TopicInsight[]> {
  const snippets = report.timeline
    .map((t) => t.description)
    .filter(Boolean)
    .slice(0, 80);

  if (snippets.length === 0) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL ?? "gpt-4o-mini";
  if (!apiKey) return fallbackTopics(snippets);

  try {
    const adapter = new OpenAICompatAdapter({
      apiKey,
      model,
      baseURL: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
    });

    const system = "Extract exactly 5 simulation topics as JSON array with fields topic,evidence,trend,confidence.";
    const user = `Timeline snippets:\n${snippets.map((s, i) => `${i + 1}. ${s}`).join("\n")}\nReturn JSON only.`;
    const response = await adapter.chat(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      { temperature: 0.2 },
    );
    const raw = response.content ?? "[]";
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end === -1 || end <= start) return fallbackTopics(snippets);
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<{
      topic?: string;
      evidence?: string;
      trend?: string;
      confidence?: number;
    }>;
    return parsed
      .map((p) => ({
        topic: String(p.topic ?? "").trim(),
        evidence: String(p.evidence ?? "").trim(),
        trend: normalizeTrend(p.trend),
        confidence: clampConfidence(p.confidence),
      }))
      .filter((p) => p.topic && p.evidence)
      .slice(0, 5);
  } catch {
    return fallbackTopics(snippets);
  }
}

function fallbackTopics(snippets: string[]): TopicInsight[] {
  const buckets: Array<{ key: string; words: string[] }> = [
    { key: "coordination", words: ["coordinate", "organize", "coalition", "plan"] },
    { key: "resourcePressure", words: ["resource", "water", "food", "energy", "ration"] },
    { key: "socialConflict", words: ["conflict", "disagree", "argue", "protest"] },
    { key: "cooperation", words: ["help", "support", "collaborate", "together"] },
    { key: "toolUsage", words: ["tool", "search", "weather", "news", "call"] },
  ];

  const counts = buckets.map((bucket) => {
    let hits = 0;
    let evidence = "";
    for (const line of snippets) {
      const lower = line.toLowerCase();
      if (bucket.words.some((w) => lower.includes(w))) {
        hits++;
        if (!evidence) evidence = line;
      }
    }
    return { bucket: bucket.key, hits, evidence };
  });

  return counts
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 5)
    .map((x) => ({
      topic: x.bucket,
      evidence: x.evidence,
      trend: "stable" as const,
      confidence: Math.min(0.95, 0.4 + x.hits / Math.max(10, snippets.length)),
    }));
}

function normalizeTrend(value: string | undefined): "rising" | "stable" | "falling" {
  if (!value) return "stable";
  const v = value.toLowerCase();
  if (v.includes("rise") || v.includes("up")) return "rising";
  if (v.includes("fall") || v.includes("down")) return "falling";
  return "stable";
}

function clampConfidence(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}
