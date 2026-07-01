import type { Stimulus } from "../types/StimulusTypes.js";
import type { Topic } from "./TopicTracker.js";

export interface KeywordTopicClassifierOptions {
  /** Minimum keyword overlap score (0-1) to match. Default: 0.35. */
  threshold?: number | undefined;
}

/**
 * Builds a synchronous topic classifier from keyword sets per topic id.
 * Useful when embedding-based classification is unavailable or as a
 * lightweight fallback before async embedding pipelines are wired.
 */
export function createKeywordTopicClassifier(
  keywordsByTopic: Map<string, string[]>,
  options: KeywordTopicClassifierOptions = {},
): (stim: Stimulus, openTopics: Topic[]) => string | null {
  const threshold = options.threshold ?? 0.35;
  const normalized = new Map<string, Set<string>>();
  for (const [topicId, words] of keywordsByTopic) {
    normalized.set(topicId, new Set(words.map((w) => w.toLowerCase())));
  }

  return (stim, openTopics) => {
    const text = extractStimulusText(stim).toLowerCase();
    if (!text || openTopics.length === 0) return null;

    const tokens = new Set(text.split(/\W+/).filter((t) => t.length > 2));
    if (tokens.size === 0) return null;

    let bestId: string | null = null;
    let bestScore = threshold;
    for (const topic of openTopics) {
      const keywords = normalized.get(topic.id);
      if (!keywords || keywords.size === 0) continue;
      let overlap = 0;
      for (const kw of keywords) {
        if (tokens.has(kw) || text.includes(kw)) overlap += 1;
      }
      const score = overlap / keywords.size;
      if (score > bestScore) {
        bestScore = score;
        bestId = topic.id;
      }
    }
    return bestId;
  };
}

/**
 * Synchronous classifier using precomputed topic embedding vectors.
 * Stimulus text must be embedded externally and attached as
 * `metadata.embedding` on the stimulus before ingest.
 */
export function createEmbeddingTopicClassifier(
  topicEmbeddings: Map<string, number[]>,
  options: { threshold?: number } = {},
): (stim: Stimulus, openTopics: Topic[]) => string | null {
  const threshold = options.threshold ?? 0.72;

  return (stim, openTopics) => {
    const stimVec = extractStimulusEmbedding(stim);
    if (!stimVec || openTopics.length === 0) return null;

    let bestId: string | null = null;
    let bestScore = threshold;
    for (const topic of openTopics) {
      const topicVec = topicEmbeddings.get(topic.id);
      if (!topicVec) continue;
      const score = cosineSimilarity(stimVec, topicVec);
      if (score > bestScore) {
        bestScore = score;
        bestId = topic.id;
      }
    }
    return bestId;
  };
}

function extractStimulusEmbedding(stim: Stimulus): number[] | undefined {
  const meta = stim.metadata as Record<string, unknown> | undefined;
  const emb = meta?.["embedding"];
  if (Array.isArray(emb) && emb.every((v) => typeof v === "number")) {
    return emb as number[];
  }
  return undefined;
}

function extractStimulusText(stim: Stimulus): string {
  const payload = stim.payload;
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const rec = payload as Record<string, unknown>;
    if (typeof rec["text"] === "string") return rec["text"] as string;
    try {
      return JSON.stringify(rec);
    } catch {
      return "";
    }
  }
  return "";
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
