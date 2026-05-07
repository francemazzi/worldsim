import type { AttentionConfig, Percept } from "../types/PerceptionTypes.js";
import type { AgentInternalState } from "../types/AgentTypes.js";
import type { NeedsState } from "../types/NeedsTypes.js";
import type { Relationship } from "../types/GraphTypes.js";

/**
 * Salience result for a single percept.
 *
 * `score` is the final number used for ranking and threshold checks;
 * `breakdown` exposes the individual components so the Studio (Phase 7)
 * and reports can explain *why* a percept was attended to.
 */
export interface RankedPercept {
  percept: Percept;
  score: number;
  breakdown: SalienceBreakdown;
}

export interface SalienceBreakdown {
  intensity: number;
  novelty: number;
  needRelevance: number;
  goalRelevance: number;
  interestMatch: number;
  relationshipBoost: number;
  recency: number;
}

export interface AttentionContext {
  agentId: string;
  agentState: AgentInternalState;
  needs?: NeedsState | undefined;
  relationships?: Relationship[] | undefined;
  /**
   * Lightweight memory of recent percepts (or stimulus ids) — used to
   * compute novelty. Pass an empty array to disable novelty boosting.
   */
  recentPerceptStimulusIds?: string[] | undefined;
  /**
   * Current tick. Used to compute recency for percepts emitted on past
   * ticks (only relevant when the StimulusBus retains > 1 tick).
   */
  currentTick: number;
  config?: AttentionConfig | undefined;
}

const DEFAULT_BUDGET = 8;
const DEFAULT_THRESHOLD = 0.1;
const DEFAULT_DISTRACTIBILITY = 0.5;
const DEFAULT_RELATIONSHIP_WEIGHT = 1.0;
const DEFAULT_NEED_WEIGHT = 1.0;

/**
 * Computes salience scores and applies the attention budget.
 *
 * Design notes:
 *  - All factors are normalized to [0, 1] and combined as a weighted average
 *    so the final score lives in [0, 1] too. This makes `threshold` easy to
 *    reason about.
 *  - `distractibility` shifts the threshold *down* (more distractible →
 *    lower bar to react). This is independent of `threshold`.
 *  - The function is pure: it does not mutate inputs and does not call out
 *    to the LLM. The engine decides whether to fire an LLM call based on
 *    `attended.length > 0`.
 */
export class AttentionPolicy {
  rank(percepts: Percept[], ctx: AttentionContext): RankedPercept[] {
    if (percepts.length === 0) return [];
    const cfg = ctx.config ?? {};
    const recentSet = new Set(ctx.recentPerceptStimulusIds ?? []);
    const interests = (cfg.interests ?? []).map((s) => s.toLowerCase());
    const needWeight = cfg.needWeight ?? DEFAULT_NEED_WEIGHT;
    const relWeight = cfg.relationshipWeight ?? DEFAULT_RELATIONSHIP_WEIGHT;
    const relStrengthBySource = indexRelationships(ctx.relationships);

    const ranked: RankedPercept[] = [];
    for (const p of percepts) {
      const breakdown: SalienceBreakdown = {
        intensity: clamp01(p.perceivedIntensity),
        novelty: recentSet.has(p.stimulus.id) ? 0 : 1,
        needRelevance: scoreNeedRelevance(p, ctx.needs) * needWeight,
        goalRelevance: scoreGoalRelevance(p, ctx.agentState.goals),
        interestMatch: scoreInterestMatch(p, interests),
        relationshipBoost: scoreRelationship(p, relStrengthBySource) * relWeight,
        recency: scoreRecency(p, ctx.currentTick),
      };

      const score = combine(breakdown);
      ranked.push({ percept: p, score, breakdown });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  }

  /**
   * Apply the budget + threshold cut. Returns only percepts the agent
   * actually pays attention to. If the result is empty, the engine should
   * NOT trigger an LLM call (passive tick).
   */
  attend(ranked: RankedPercept[], cfg?: AttentionConfig): RankedPercept[] {
    const budget = cfg?.budget ?? DEFAULT_BUDGET;
    const threshold = cfg?.threshold ?? DEFAULT_THRESHOLD;
    const distractibility = clamp01(cfg?.distractibility ?? DEFAULT_DISTRACTIBILITY);
    // distractibility shifts the threshold down: at 1.0 nothing is filtered
    // out by threshold; at 0.0 the threshold applies as-is.
    const effectiveThreshold = threshold * (1 - distractibility);
    const filtered = ranked.filter((r) => r.score >= effectiveThreshold);
    return filtered.slice(0, Math.max(0, budget));
  }

  /**
   * Convenience: rank + attend in one call.
   */
  process(percepts: Percept[], ctx: AttentionContext): RankedPercept[] {
    const ranked = this.rank(percepts, ctx);
    return this.attend(ranked, ctx.config);
  }
}

// ── Helpers ────────────────────────────────────────────────────────

function indexRelationships(rels?: Relationship[]): Map<string, number> {
  const m = new Map<string, number>();
  if (!rels) return m;
  for (const r of rels) {
    // strength is normalized into [0, 1] by clipping. Worldsim tends to use
    // 0..1 already but legacy stores may emit higher values.
    const s = clamp01(r.strength);
    const prev = m.get(r.to) ?? 0;
    if (s > prev) m.set(r.to, s);
  }
  return m;
}

function scoreNeedRelevance(p: Percept, needs?: NeedsState): number {
  if (!needs || needs.needs.length === 0) return 0;
  const tags = collectTags(p);
  if (tags.size === 0) return 0;
  let best = 0;
  for (const need of needs.needs) {
    const activation = need.activationThreshold ?? 0.5;
    if (need.value < activation) continue;
    if (!need.tags || need.tags.length === 0) continue;
    let matched = false;
    for (const t of need.tags) {
      if (tags.has(t.toLowerCase())) {
        matched = true;
        break;
      }
    }
    if (matched) {
      const weight = (need.value - activation) / Math.max(1 - activation, Number.EPSILON);
      if (weight > best) best = clamp01(weight);
    }
  }
  return best;
}

function scoreGoalRelevance(p: Percept, goals: string[]): number {
  if (!goals || goals.length === 0) return 0;
  const text = stringifyPayload(p).toLowerCase();
  if (!text) return 0;
  for (const goal of goals) {
    const lc = goal.toLowerCase();
    if (lc.length < 3) continue;
    if (text.includes(lc)) return 1;
    const tokens = lc.split(/\W+/).filter((t) => t.length > 3);
    for (const tok of tokens) {
      if (text.includes(tok)) return 0.5;
    }
  }
  return 0;
}

function scoreInterestMatch(p: Percept, interests: string[]): number {
  if (interests.length === 0) return 0;
  const tags = collectTags(p);
  for (const i of interests) {
    if (tags.has(i)) return 1;
  }
  const text = stringifyPayload(p).toLowerCase();
  for (const i of interests) {
    if (text.includes(i)) return 0.6;
  }
  return 0;
}

function scoreRelationship(p: Percept, byTarget: Map<string, number>): number {
  const sourceId = p.stimulus.source.id;
  return byTarget.get(sourceId) ?? 0;
}

function scoreRecency(p: Percept, currentTick: number): number {
  const delta = currentTick - p.tick;
  if (delta <= 0) return 1;
  if (delta >= 5) return 0;
  return 1 - delta / 5;
}

function combine(b: SalienceBreakdown): number {
  // Weighted average — the weights deliberately add to 1 so the score is
  // interpretable as a probability-ish [0,1]. Tunable via AttentionConfig in
  // the future.
  const sum =
    0.25 * b.intensity +
    0.10 * b.novelty +
    0.20 * b.needRelevance +
    0.15 * b.goalRelevance +
    0.20 * b.interestMatch +
    0.05 * clamp01(b.relationshipBoost) +
    0.05 * b.recency;
  return clamp01(sum);
}

function collectTags(p: Percept): Set<string> {
  const out = new Set<string>();
  const meta = (p.stimulus.metadata as Record<string, unknown> | undefined) ?? {};
  const tags = meta["tags"];
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (typeof t === "string") out.add(t.toLowerCase());
    }
  }
  const payload = p.stimulus.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const recPayload = payload as Record<string, unknown>;
    const inlineTags = recPayload["tags"];
    if (Array.isArray(inlineTags)) {
      for (const t of inlineTags) {
        if (typeof t === "string") out.add(t.toLowerCase());
      }
    }
  }
  return out;
}

function stringifyPayload(p: Percept): string {
  const payload = p.stimulus.payload;
  if (typeof payload === "string") return payload;
  if (!payload) return "";
  if (typeof payload === "object" && payload !== null) {
    const rec = payload as Record<string, unknown>;
    if (typeof rec["text"] === "string") return rec["text"] as string;
    try {
      return JSON.stringify(rec);
    } catch {
      return "";
    }
  }
  return String(payload);
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
