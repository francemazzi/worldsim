import { OpenAICompatAdapter } from "../llm/OpenAICompatAdapter.js";
import type {
  AgentArc,
  CriticalNeedMoment,
  NarrativeArc,
  NarrativeQuote,
  NarrativeReport,
  NarrativeTopicSummary,
  PerceptionInsights,
  PerceptionTopicSummary,
  SimulationReport,
} from "../types/ReportTypes.js";
import type { AgentAction } from "../types/AgentTypes.js";

export interface NarrativeOptions {
  apiKey?: string | undefined;
  model?: string | undefined;
  baseURL?: string | undefined;
}

/**
 * Generates a qualitative narrative of the run using three parallel LLM calls:
 *   1. Global arc (pre / trigger / post).
 *   2. Per-agent arc summary.
 *   3. Emblematic quotes extracted from the timeline.
 *
 * Falls back to a heuristic narrative when no API key is configured so the
 * endpoint never breaks the dashboard, just degrades gracefully.
 */
export async function generateNarrative(
  report: SimulationReport,
  options: NarrativeOptions = {},
): Promise<NarrativeReport> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  const model = options.model ?? process.env.LLM_MODEL ?? "gpt-4o-mini";
  const baseURL =
    options.baseURL ?? process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";

  const perceptionInsights = computePerceptionInsights(report);

  if (!apiKey) return fallbackNarrative(report, perceptionInsights);

  const adapter = new OpenAICompatAdapter({ apiKey, model, baseURL });

  const [arc, perAgentArc, quotes] = await Promise.all([
    generateArc(adapter, report, perceptionInsights).catch(() => fallbackArc(report)),
    generatePerAgentArc(adapter, report).catch(() => fallbackPerAgentArc(report)),
    generateQuotes(adapter, report).catch(() => fallbackQuotes(report)),
  ]);

  return {
    arc,
    perAgentArc,
    quotes,
    ...(perceptionInsights ? { perceptionInsights } : {}),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Pure, LLM-free derivation of {@link PerceptionInsights} from a report.
 * Returns `undefined` when the report has no perception metrics — keeps
 * legacy reports unchanged.
 */
export function computePerceptionInsights(
  report: SimulationReport,
): PerceptionInsights | undefined {
  const perception = report.metrics.perception;
  if (!perception) return undefined;

  const dominantTopics = pickDominantTopics(report);
  const silenceRatio = computeSilenceRatio(report);
  const criticalNeedMoments = collectCriticalNeedMoments(report);

  return { dominantTopics, silenceRatio, criticalNeedMoments };
}

async function generateArc(
  adapter: OpenAICompatAdapter,
  report: SimulationReport,
  insights: PerceptionInsights | undefined,
): Promise<NarrativeArc[]> {
  const triggerTick = report.shock?.triggerTick;
  const snippets = report.timeline
    .slice(0, 120)
    .map((t) => `t=${t.tick} [${t.type}] ${t.description}`)
    .join("\n");
  const system =
    "Sei un sociologo che riassume una simulazione multi-agente in italiano. Rispondi esclusivamente con JSON valido del tipo [{\"phase\":\"pre|trigger|post|full\",\"summary\":\"...\"}].";
  const perceptionBlock = insights ? buildPerceptionPromptBlock(insights) : "";
  const user = `Scenario: ${report.summary.worldId}\nTrigger tick: ${triggerTick ?? "nessuno"}\nEventi:\n${snippets}${perceptionBlock}\nProduci 3 fasi (pre, trigger, post) se esiste un trigger, altrimenti una sola fase full.`;
  const response = await adapter.chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.3 },
  );
  const arc = parseJsonArray(response.content) as Array<{ phase?: string; summary?: string }>;
  return arc
    .map((a) => ({
      phase: normalizePhase(a.phase),
      summary: String(a.summary ?? "").trim(),
    }))
    .filter((a) => a.summary);
}

async function generatePerAgentArc(
  adapter: OpenAICompatAdapter,
  report: SimulationReport,
): Promise<AgentArc[]> {
  const personAgents = report.agents.filter((a) => a.role !== "control");
  if (personAgents.length === 0) return [];
  const system =
    "Sei un sociologo. Produci un arco narrativo (max 300 caratteri) per ciascun agente in italiano. Output JSON: [{\"agentId\":\"...\",\"arc\":\"...\"}].";
  const profiles = personAgents
    .map((a) => {
      const moods = a.moodTrajectory.map((s) => s.mood).join(" -> ");
      return `- ${a.agentId} (${a.name}, ${a.personality.join("/")}): azioni=${a.totalActions}, mood=${moods}`;
    })
    .join("\n");
  const user = `Agenti:\n${profiles}\nOutput JSON puro.`;
  const response = await adapter.chat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.3 },
  );
  const parsed = parseJsonArray(response.content) as Array<{ agentId?: string; arc?: string }>;
  const byId = new Map(parsed.map((p) => [String(p.agentId ?? ""), String(p.arc ?? "")]));
  return personAgents.map((a) => ({
    agentId: a.agentId,
    arc: byId.get(a.agentId)?.trim() ?? fallbackAgentArc(a),
  }));
}

async function generateQuotes(
  adapter: OpenAICompatAdapter,
  report: SimulationReport,
): Promise<NarrativeQuote[]> {
  const speaks = report.rawActions.filter((a) => a.actionType === "speak");
  // Prefer quotes carrying a topicId so the sociologist sees on-thread
  // exchanges first; the rest is appended after.
  const inTopic: AgentAction[] = [];
  const outOfTopic: AgentAction[] = [];
  for (const a of speaks) {
    if (hasTopicId(a)) inTopic.push(a);
    else outOfTopic.push(a);
  }
  const ordered = [...inTopic, ...outOfTopic].slice(0, 60);
  const spoken = ordered
    .map((a) => {
      const content =
        typeof a.payload === "string"
          ? a.payload
          : typeof (a.payload as { content?: string })?.content === "string"
            ? (a.payload as { content?: string }).content!
            : "";
      return `t=${a.tick} ${a.agentId}: ${content}`;
    })
    .filter(Boolean)
    .join("\n");
  if (!spoken) return [];
  const system =
    "Estrai 5 citazioni emblematiche dalla simulazione. JSON: [{\"agentId\":\"...\",\"tick\":0,\"content\":\"...\",\"tag\":\"tensione|cooperazione|dubbio|adesione|protesta\"}].";
  const response = await adapter.chat(
    [
      { role: "system", content: system },
      { role: "user", content: `Speak:\n${spoken}` },
    ],
    { temperature: 0.2 },
  );
  const parsed = parseJsonArray(response.content) as Array<{
    agentId?: string;
    tick?: number;
    content?: string;
    tag?: string;
  }>;
  return parsed
    .slice(0, 8)
    .map((q) => ({
      agentId: String(q.agentId ?? ""),
      tick: Number(q.tick ?? 0),
      content: String(q.content ?? "").trim(),
      tag: String(q.tag ?? "generico"),
    }))
    .filter((q) => q.agentId && q.content);
}

function parseJsonArray(raw: string | undefined): unknown[] {
  if (!raw) return [];
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizePhase(value: string | undefined): NarrativeArc["phase"] {
  const v = (value ?? "").toLowerCase();
  if (v === "pre" || v === "trigger" || v === "post" || v === "full") return v;
  return "full";
}

function fallbackNarrative(
  report: SimulationReport,
  perceptionInsights?: PerceptionInsights | undefined,
): NarrativeReport {
  return {
    arc: fallbackArc(report),
    perAgentArc: fallbackPerAgentArc(report),
    quotes: fallbackQuotes(report),
    ...(perceptionInsights ? { perceptionInsights } : {}),
    generatedAt: new Date().toISOString(),
  };
}

function fallbackArc(report: SimulationReport): NarrativeArc[] {
  const triggerTick = report.shock?.triggerTick;
  if (triggerTick != null) {
    return [
      {
        phase: "pre",
        summary: `Pre-trigger (fino a t=${triggerTick - 1}): mood dominante ${report.shock?.pre.avgMood ?? "n/d"}, energia media ${report.shock?.pre.avgEnergy ?? 0}.`,
      },
      {
        phase: "trigger",
        summary: `Trigger a t=${triggerTick}: ${report.shock?.description ?? "policy attivata"}.`,
      },
      {
        phase: "post",
        summary: `Post-trigger: mood ${report.shock?.post.avgMood ?? "n/d"}, energia ${report.shock?.post.avgEnergy ?? 0}, recovery in ${report.shock?.recoveryTicks ?? "mai"} tick.`,
      },
    ];
  }
  return [
    {
      phase: "full",
      summary: `Simulazione di ${report.summary.totalTicks} tick con ${report.summary.agentCount} agenti e ${report.summary.totalActions} azioni.`,
    },
  ];
}

function fallbackPerAgentArc(report: SimulationReport): AgentArc[] {
  return report.agents
    .filter((a) => a.role !== "control")
    .map((a) => ({ agentId: a.agentId, arc: fallbackAgentArc(a) }));
}

function fallbackAgentArc(a: { name: string; totalActions: number; actions: { speak: number } }): string {
  return `${a.name}: ${a.totalActions} azioni totali, ${a.actions.speak} interventi verbali.`;
}

function fallbackQuotes(report: SimulationReport): NarrativeQuote[] {
  const speakActions = report.rawActions.filter((a) => a.actionType === "speak");
  return speakActions.slice(0, 5).map((a) => {
    const content =
      typeof a.payload === "string"
        ? a.payload
        : typeof (a.payload as { content?: string })?.content === "string"
          ? (a.payload as { content?: string }).content!
          : "";
    return {
      agentId: a.agentId,
      tick: a.tick,
      content: content.slice(0, 200),
      tag: "generico",
    };
  });
}

// ── Perception insights helpers ────────────────────────────────────

function pickDominantTopics(report: SimulationReport): NarrativeTopicSummary[] {
  const topics = report.metrics.perception?.topics;
  if (topics && topics.length > 0) {
    return [...topics]
      .sort((a, b) => b.stimuliCount - a.stimuliCount)
      .slice(0, 5)
      .map(toNarrativeTopic);
  }
  // Fallback: derive from rawActions metadata when the report doesn't
  // ship enriched topic snapshots (e.g. legacy plugins, custom builds).
  const buckets = new Map<string, { participants: Set<string>; count: number }>();
  for (const a of report.rawActions) {
    if (a.actionType !== "speak") continue;
    const topicId = readTopicId(a);
    if (!topicId) continue;
    let bucket = buckets.get(topicId);
    if (!bucket) {
      bucket = { participants: new Set(), count: 0 };
      buckets.set(topicId, bucket);
    }
    bucket.count += 1;
    bucket.participants.add(a.agentId);
  }
  return [...buckets.entries()]
    .map(([id, b]) => ({
      id,
      stimuliCount: b.count,
      participants: [...b.participants],
    }))
    .sort((a, b) => b.stimuliCount - a.stimuliCount)
    .slice(0, 5);
}

function toNarrativeTopic(t: PerceptionTopicSummary): NarrativeTopicSummary {
  return {
    id: t.id,
    ...(t.label ? { label: t.label } : {}),
    stimuliCount: t.stimuliCount,
    participants: [...t.participants],
  };
}

function computeSilenceRatio(report: SimulationReport): number {
  let perceive = 0;
  let speak = 0;
  for (const a of report.agents) {
    if (a.role === "control") continue;
    perceive += a.actions.perceive ?? 0;
    speak += a.actions.speak ?? 0;
  }
  const total = perceive + speak;
  if (total === 0) return 0;
  return Math.round((perceive / total) * 1000) / 1000;
}

function collectCriticalNeedMoments(
  report: SimulationReport,
): CriticalNeedMoment[] {
  const moments: CriticalNeedMoment[] = [];
  for (const entry of report.timeline) {
    const meta = entry.metadata as Record<string, unknown> | undefined;
    if (!meta) continue;
    const needId = typeof meta["criticalNeed"] === "string" ? (meta["criticalNeed"] as string) : undefined;
    const agentId = typeof meta["agentId"] === "string" ? (meta["agentId"] as string) : undefined;
    if (!needId || !agentId) continue;
    moments.push({ agentId, needId, tick: entry.tick });
  }
  return moments;
}

function buildPerceptionPromptBlock(insights: PerceptionInsights): string {
  const lines: string[] = ["", "Contesto percettivo:"];
  if (insights.dominantTopics.length > 0) {
    lines.push("- Topic principali:");
    for (const t of insights.dominantTopics.slice(0, 3)) {
      const label = t.label ?? t.id;
      const parts = t.participants.length > 0 ? t.participants.join(", ") : "(nessuno)";
      lines.push(`  • ${label}: ${t.stimuliCount} stimoli, partecipanti ${parts}`);
    }
  }
  lines.push(`- Silence ratio: ${(insights.silenceRatio * 100).toFixed(0)}% (perceive su perceive+speak)`);
  if (insights.criticalNeedMoments.length > 0) {
    lines.push(`- Picchi di need critici: ${insights.criticalNeedMoments.length}`);
  }
  return `\n${lines.join("\n")}\n`;
}

function readTopicId(action: AgentAction): string | undefined {
  const meta = action.metadata as Record<string, unknown> | undefined;
  if (!meta) return undefined;
  const value = meta["topicId"];
  return typeof value === "string" ? value : undefined;
}

function hasTopicId(action: AgentAction): boolean {
  return readTopicId(action) !== undefined;
}
