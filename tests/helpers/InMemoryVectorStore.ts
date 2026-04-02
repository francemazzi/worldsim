import type {
  VectorStore,
  VectorEntry,
  VectorQuery,
  VectorSearchResult,
} from "../../src/types/VectorTypes.js";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    magA += (a[i] ?? 0) ** 2;
    magB += (b[i] ?? 0) ** 2;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export class InMemoryVectorStore implements VectorStore {
  private entries: Map<string, VectorEntry> = new Map();

  async upsert(entry: VectorEntry): Promise<void> {
    this.entries.set(entry.id, entry);
  }

  async upsertBatch(entries: VectorEntry[]): Promise<void> {
    for (const e of entries) {
      this.entries.set(e.id, e);
    }
  }

  async search(query: VectorQuery): Promise<VectorSearchResult[]> {
    const queryEmbedding = query.embedding ?? query.text
      ? undefined
      : undefined;

    if (!query.embedding) {
      // Without an embedding we cannot perform similarity search.
      // Return empty — callers should embed via EmbeddingAdapter first.
      return [];
    }

    const topK = query.topK ?? 10;
    const minScore = query.minScore ?? 0;

    const results: VectorSearchResult[] = [];

    for (const entry of this.entries.values()) {
      if (entry.agentId !== query.agentId) continue;

      if (query.filter) {
        let matches = true;
        for (const [key, value] of Object.entries(query.filter)) {
          if (entry.metadata?.[key] !== value) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
      }

      const score = cosineSimilarity(query.embedding, entry.embedding);
      if (score >= minScore) {
        results.push({ entry, score });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async delete(agentId: string, ids: string[]): Promise<void> {
    for (const id of ids) {
      const entry = this.entries.get(id);
      if (entry && entry.agentId === agentId) {
        this.entries.delete(id);
      }
    }
  }

  async clear(agentId: string): Promise<void> {
    for (const [id, entry] of this.entries) {
      if (entry.agentId === agentId) {
        this.entries.delete(id);
      }
    }
  }

  getAll(): VectorEntry[] {
    return Array.from(this.entries.values());
  }
}
