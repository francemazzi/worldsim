import { randomUUID } from "node:crypto";
import type { MemoryStore, MemoryEntry } from "../types/MemoryTypes.js";
import type { PersistenceStore, ConsolidatedKnowledge } from "../types/PersistenceTypes.js";
import type { VectorStore } from "../types/VectorTypes.js";
import type {
  ConsolidationConfig,
  ConsolidationResult,
  ImportanceScore,
} from "../types/ConsolidationTypes.js";
import type { LLMAdapter } from "../llm/LLMAdapter.js";

const DEFAULT_CONFIG: ConsolidationConfig = {
  retentionDays: 30,
  importanceThreshold: 0.6,
  batchSize: 100,
  scoringStrategy: "hybrid",
  generateSummaries: true,
};

const TYPE_WEIGHTS: Record<MemoryEntry["type"], number> = {
  knowledge: 1.0,
  reflection: 0.8,
  conversation: 0.6,
  observation: 0.4,
  action: 0.2,
};

export class MemoryConsolidator {
  private memoryStore: MemoryStore;
  private persistenceStore: PersistenceStore;
  private vectorStore?: VectorStore | undefined;
  private llm?: LLMAdapter | undefined;
  private config: ConsolidationConfig;

  constructor(options: {
    memoryStore: MemoryStore;
    persistenceStore: PersistenceStore;
    vectorStore?: VectorStore | undefined;
    llm?: LLMAdapter | undefined;
    config?: Partial<ConsolidationConfig> | undefined;
  }) {
    this.memoryStore = options.memoryStore;
    this.persistenceStore = options.persistenceStore;
    this.vectorStore = options.vectorStore;
    this.llm = options.llm;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  async consolidate(
    agentId: string,
    worldId: string,
  ): Promise<ConsolidationResult> {
    const start = Date.now();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.config.retentionDays);

    const oldEntries = await this.persistenceStore.getMemoryEntries(
      agentId,
      worldId,
      { before: cutoff },
    );

    if (oldEntries.length === 0) {
      return {
        agentId,
        processed: 0,
        promoted: 0,
        summarized: 0,
        deleted: 0,
        duration: Date.now() - start,
      };
    }

    let promoted = 0;
    let summarized = 0;
    let deleted = 0;
    const toDelete: string[] = [];
    const toPromote: MemoryEntry[] = [];

    for (let i = 0; i < oldEntries.length; i += this.config.batchSize) {
      const batch = oldEntries.slice(i, i + this.config.batchSize);
      const scores = await this.scoreImportance(batch);

      for (const score of scores) {
        const entry = batch.find((e) => e.id === score.memoryId);
        if (!entry) continue;

        if (score.score >= this.config.importanceThreshold) {
          toPromote.push(entry);
          promoted++;
        } else {
          toDelete.push(entry.id);
          deleted++;
        }
      }
    }

    // Promote important memories as consolidated knowledge
    for (const entry of toPromote) {
      await this.persistenceStore.saveKnowledge({
        id: randomUUID(),
        agentId,
        worldId,
        summary: entry.content,
        sourceMemoryIds: [entry.id],
        importance: entry.importance ?? TYPE_WEIGHTS[entry.type] ?? 0.5,
        category: entry.type,
        createdAt: new Date(),
      });
    }

    // Generate summaries from low-importance entries if configured
    if (this.config.generateSummaries && toDelete.length > 0) {
      const lowEntries = oldEntries.filter((e) => toDelete.includes(e.id));
      const summaryCount = await this.generateSummaries(
        agentId,
        worldId,
        lowEntries,
      );
      summarized = summaryCount;
    }

    // Delete from stores
    if (toDelete.length > 0) {
      await this.persistenceStore.deleteMemoryEntries(toDelete);
      if (this.vectorStore) {
        await this.vectorStore.delete(agentId, toDelete);
      }
    }

    return {
      agentId,
      processed: oldEntries.length,
      promoted,
      summarized,
      deleted,
      duration: Date.now() - start,
    };
  }

  async scoreImportance(entries: MemoryEntry[]): Promise<ImportanceScore[]> {
    const { scoringStrategy } = this.config;

    if (scoringStrategy === "heuristic" || !this.llm) {
      return entries.map((e) => this.heuristicScore(e));
    }

    if (scoringStrategy === "llm") {
      return this.llmScore(entries);
    }

    // Hybrid: heuristic first, LLM for borderline cases
    const heuristics = entries.map((e) => this.heuristicScore(e));
    const borderline = heuristics.filter(
      (s) => s.score >= 0.4 && s.score <= 0.7,
    );

    if (borderline.length === 0 || !this.llm) return heuristics;

    const borderlineEntries = borderline
      .map((s) => entries.find((e) => e.id === s.memoryId))
      .filter((e): e is MemoryEntry => e != null);

    const llmScores = await this.llmScore(borderlineEntries);
    const llmMap = new Map(llmScores.map((s) => [s.memoryId, s]));

    return heuristics.map((h) => llmMap.get(h.memoryId) ?? h);
  }

  private heuristicScore(entry: MemoryEntry): ImportanceScore {
    let score = 0;

    // Type weight (40%)
    score += (TYPE_WEIGHTS[entry.type] ?? 0.3) * 0.4;

    // Explicit importance if set (30%)
    if (entry.importance != null) {
      score += entry.importance * 0.3;
    } else {
      score += 0.15; // neutral default
    }

    // Content length as proxy for richness (15%)
    const contentLen = entry.content.length;
    const lenScore = Math.min(contentLen / 500, 1.0);
    score += lenScore * 0.15;

    // Has metadata (15%)
    const metaScore =
      entry.metadata && Object.keys(entry.metadata).length > 0 ? 1.0 : 0.0;
    score += metaScore * 0.15;

    return {
      memoryId: entry.id,
      score: Math.min(Math.max(score, 0), 1),
    };
  }

  private async llmScore(entries: MemoryEntry[]): Promise<ImportanceScore[]> {
    if (!this.llm || entries.length === 0) {
      return entries.map((e) => this.heuristicScore(e));
    }

    const entrySummaries = entries
      .map(
        (e, i) =>
          `[${i}] id=${e.id} type=${e.type} tick=${e.tick}: ${e.content.slice(0, 200)}`,
      )
      .join("\n");

    const response = await this.llm.chat([
      {
        role: "system",
        content:
          "You are a memory consolidation system. Score each memory entry for long-term importance (0.0 to 1.0). Consider: Would this memory influence future decisions? Does it contain a lesson, key relationship event, or critical information? Respond with a JSON array: [{\"memoryId\": \"...\", \"score\": 0.X, \"reasoning\": \"...\"}]",
      },
      {
        role: "user",
        content: `Score these memory entries:\n${entrySummaries}`,
      },
    ]);

    try {
      const match = response.content.match(/\[[\s\S]*\]/);
      if (!match) return entries.map((e) => this.heuristicScore(e));

      const parsed = JSON.parse(match[0]) as ImportanceScore[];
      return parsed.filter(
        (s) =>
          typeof s.memoryId === "string" &&
          typeof s.score === "number" &&
          s.score >= 0 &&
          s.score <= 1,
      );
    } catch {
      return entries.map((e) => this.heuristicScore(e));
    }
  }

  private async generateSummaries(
    agentId: string,
    worldId: string,
    entries: MemoryEntry[],
  ): Promise<number> {
    if (!this.llm || entries.length === 0) return 0;

    // Group by type for better summaries
    const grouped = new Map<string, MemoryEntry[]>();
    for (const entry of entries) {
      const key = entry.type;
      const group = grouped.get(key) ?? [];
      group.push(entry);
      grouped.set(key, group);
    }

    let count = 0;

    for (const [type, group] of grouped) {
      if (group.length < 2) continue;

      const contents = group
        .map((e) => `[tick ${e.tick}] ${e.content.slice(0, 150)}`)
        .join("\n");

      const response = await this.llm.chat([
        {
          role: "system",
          content:
            "Summarize these memory entries into a single concise paragraph that captures the key themes and insights. Respond with only the summary text.",
        },
        {
          role: "user",
          content: `${group.length} ${type} entries:\n${contents}`,
        },
      ]);

      await this.persistenceStore.saveKnowledge({
        id: randomUUID(),
        agentId,
        worldId,
        summary: response.content,
        sourceMemoryIds: group.map((e) => e.id),
        importance: 0.4,
        category: `summary:${type}`,
        createdAt: new Date(),
      });

      count++;
    }

    return count;
  }
}
