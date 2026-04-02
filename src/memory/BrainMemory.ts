import { randomUUID } from "node:crypto";
import type { MemoryStore, MemoryEntry } from "../types/MemoryTypes.js";
import type { VectorStore } from "../types/VectorTypes.js";
import type { EmbeddingAdapter } from "../types/VectorTypes.js";
import type {
  PersistenceStore,
  ConsolidatedKnowledge,
} from "../types/PersistenceTypes.js";
import type { GraphStore } from "../types/GraphTypes.js";
import type { AgentInternalState } from "../types/AgentTypes.js";
import type {
  ConsolidationConfig,
  ConsolidationResult,
} from "../types/ConsolidationTypes.js";
import type { LLMAdapter } from "../llm/LLMAdapter.js";
import { EmbeddingManager } from "./EmbeddingManager.js";
import { MemoryConsolidator } from "./MemoryConsolidator.js";

export interface RecallOptions {
  agentId: string;
  recentLimit?: number;
  semanticQuery?: string;
  semanticTopK?: number;
  includeKnowledge?: boolean;
}

export interface RecallResult {
  memories: MemoryEntry[];
  knowledge: ConsolidatedKnowledge[];
}

export class BrainMemory {
  private memoryStore: MemoryStore;
  private vectorStore?: VectorStore | undefined;
  private persistenceStore?: PersistenceStore | undefined;
  private graphStore?: GraphStore | undefined;
  private embeddingManager?: EmbeddingManager | undefined;
  private consolidator?: MemoryConsolidator | undefined;

  constructor(options: {
    memoryStore: MemoryStore;
    vectorStore?: VectorStore | undefined;
    persistenceStore?: PersistenceStore | undefined;
    embeddingAdapter?: EmbeddingAdapter | undefined;
    graphStore?: GraphStore | undefined;
    llm?: LLMAdapter | undefined;
    consolidation?: Partial<ConsolidationConfig> | undefined;
  }) {
    this.memoryStore = options.memoryStore;
    this.vectorStore = options.vectorStore;
    this.persistenceStore = options.persistenceStore;
    this.graphStore = options.graphStore;

    if (options.embeddingAdapter) {
      this.embeddingManager = new EmbeddingManager(options.embeddingAdapter);
    }

    if (options.persistenceStore) {
      this.consolidator = new MemoryConsolidator({
        memoryStore: options.memoryStore,
        persistenceStore: options.persistenceStore,
        vectorStore: options.vectorStore,
        llm: options.llm,
        config: options.consolidation,
      });
    }
  }

  async save(entry: MemoryEntry, worldId: string): Promise<void> {
    const ops: Promise<void>[] = [];

    ops.push(this.memoryStore.save(entry));

    if (this.persistenceStore) {
      ops.push(
        this.persistenceStore.saveMemoryEntry({ ...entry, worldId }),
      );
    }

    if (this.vectorStore && this.embeddingManager) {
      const embedding = await this.embeddingManager.embedEntry(entry);
      ops.push(
        this.vectorStore.upsert({
          id: entry.id,
          agentId: entry.agentId,
          content: entry.content,
          embedding,
          ...(entry.metadata ? { metadata: entry.metadata } : {}),
          timestamp: entry.timestamp,
          memoryEntryId: entry.id,
        }),
      );
    }

    await Promise.allSettled(ops);
  }

  async saveBatch(entries: MemoryEntry[], worldId: string): Promise<void> {
    const ops: Promise<void>[] = [];

    ops.push(this.memoryStore.saveBatch(entries));

    if (this.persistenceStore) {
      ops.push(
        this.persistenceStore.saveMemoryEntries(
          entries.map((e) => ({ ...e, worldId })),
        ),
      );
    }

    if (this.vectorStore && this.embeddingManager) {
      const embeddings = await this.embeddingManager.embedEntries(entries);
      ops.push(
        this.vectorStore.upsertBatch(
          entries.map((e, i) => ({
            id: e.id,
            agentId: e.agentId,
            content: e.content,
            embedding: embeddings[i]!,
            ...(e.metadata ? { metadata: e.metadata } : {}),
            timestamp: e.timestamp,
            memoryEntryId: e.id,
          })),
        ),
      );
    }

    await Promise.allSettled(ops);
  }

  async recall(options: RecallOptions): Promise<RecallResult> {
    const {
      agentId,
      recentLimit = 20,
      semanticQuery,
      semanticTopK = 5,
      includeKnowledge = true,
    } = options;

    const ops: {
      recent: Promise<MemoryEntry[]>;
      semantic: Promise<MemoryEntry[]>;
      knowledge: Promise<ConsolidatedKnowledge[]>;
    } = {
      recent: this.memoryStore.getRecent(agentId, recentLimit),
      semantic: Promise.resolve([]),
      knowledge: Promise.resolve([]),
    };

    if (
      semanticQuery &&
      this.vectorStore &&
      this.embeddingManager
    ) {
      ops.semantic = (async () => {
        const embedding =
          await this.embeddingManager!.embedText(semanticQuery);
        const results = await this.vectorStore!.search({
          agentId,
          embedding,
          topK: semanticTopK,
          minScore: 0.3,
        });
        return results.map((r) => ({
          id: r.entry.memoryEntryId ?? r.entry.id,
          agentId: r.entry.agentId,
          tick: 0,
          type: "observation" as const,
          content: r.entry.content,
          metadata: { ...r.entry.metadata, similarityScore: r.score },
          timestamp: r.entry.timestamp,
          importance: r.score,
        }));
      })();
    }

    if (includeKnowledge && this.persistenceStore) {
      ops.knowledge = (async () => {
        // worldId is not available here, so we get all knowledge for agent
        // The caller should filter by worldId if needed
        return [];
      })();
    }

    const [recentMemories, semanticMemories, knowledge] = await Promise.all([
      ops.recent,
      ops.semantic,
      ops.knowledge,
    ]);

    // Deduplicate: recent takes priority, then semantic
    const seen = new Set<string>();
    const merged: MemoryEntry[] = [];

    for (const m of recentMemories) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        merged.push(m);
      }
    }
    for (const m of semanticMemories) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        merged.push(m);
      }
    }

    return { memories: merged, knowledge };
  }

  async recallWithWorld(
    options: RecallOptions & { worldId: string },
  ): Promise<RecallResult> {
    const base = await this.recall(options);

    if (options.includeKnowledge !== false && this.persistenceStore) {
      base.knowledge = await this.persistenceStore.getKnowledge(
        options.agentId,
        options.worldId,
      );
    }

    return base;
  }

  async consolidate(
    agentId: string,
    worldId: string,
  ): Promise<ConsolidationResult> {
    if (!this.consolidator) {
      return {
        agentId,
        processed: 0,
        promoted: 0,
        summarized: 0,
        deleted: 0,
        duration: 0,
      };
    }
    return this.consolidator.consolidate(agentId, worldId);
  }

  async getKnowledge(
    agentId: string,
    worldId: string,
  ): Promise<ConsolidatedKnowledge[]> {
    if (!this.persistenceStore) return [];
    return this.persistenceStore.getKnowledge(agentId, worldId);
  }

  async snapshotState(
    agentId: string,
    worldId: string,
    tick: number,
    state: AgentInternalState,
  ): Promise<void> {
    if (!this.persistenceStore) return;
    await this.persistenceStore.saveStateSnapshot({
      id: randomUUID(),
      agentId,
      worldId,
      tick,
      state,
      timestamp: new Date(),
    });
  }

  async restoreState(
    agentId: string,
    worldId: string,
  ): Promise<AgentInternalState | null> {
    if (!this.persistenceStore) return null;
    const snapshot = await this.persistenceStore.getLatestState(
      agentId,
      worldId,
    );
    return snapshot?.state ?? null;
  }
}
