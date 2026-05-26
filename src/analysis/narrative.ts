import { OpenAICompatAdapter } from "../llm/OpenAICompatAdapter.js";
import { resolveLlmEnv } from "../llm/resolveLlmEnv.js";
import type {
  AgentArc,
  NarrativeArc,
  NarrativeQuote,
  NarrativeReport,
  SimulationReport,
} from "../types/ReportTypes.js";

export interface NarrativeOptions {
  apiKey?: string | undefined;
  model?: string | undefined;
  baseURL?: string | undefined;
  headers?: Record<string, string> | undefined;
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
  const llmConfig = resolveLlmEnv(options);
  if (!llmConfig) return fallbackNarrative(report);

  const adapter = new OpenAICompatAdapter(llmConfig);

  const [arc, perAgentArc, quotes] = await Promise.all([
    generateArc(adapter, report).catch(() => fallbackArc(report)),
    generatePerAgentArc(adapter, report).catch(() => fallbackPerAgentArc(report)),
    generateQuotes(adapter, report).catch(() => fallbackQuotes(report)),
  ]);

  return {
    arc,
    perAgentArc,
    quotes,
    generatedAt: new Date().toISOString(),
  };
}

async function generateArc(
  adapter: OpenAICompatAdapter,
  report: SimulationReport,
): Promise<NarrativeArc[]> {
  const triggerTick = report.shock?.triggerTick;
  const snippets = report.timeline
    .slice(0, 120)
    .map((t) => `t=${t.tick} [${t.type}] ${t.description}`)
    .join("\n");
  const system =
    "Sei un sociologo che riassume una simulazione multi-agente in italiano. Rispondi esclusivamente con JSON valido del tipo [{\"phase\":\"pre|trigger|post|full\",\"summary\":\"...\"}].";
  const user = `Scenario: ${report.summary.worldId}\nTrigger tick: ${triggerTick ?? "nessuno"}\nEventi:\n${snippets}\nProduci 3 fasi (pre, trigger, post) se esiste un trigger, altrimenti una sola fase full.`;
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
  const spoken = report.rawActions
    .filter((a) => a.actionType === "speak")
    .slice(0, 60)
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

function fallbackNarrative(report: SimulationReport): NarrativeReport {
  return {
    arc: fallbackArc(report),
    perAgentArc: fallbackPerAgentArc(report),
    quotes: fallbackQuotes(report),
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
