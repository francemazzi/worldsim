import type { EmbeddingAdapter } from "../types/VectorTypes.js";
import type { MemoryEntry } from "../types/MemoryTypes.js";

export class EmbeddingManager {
  private adapter: EmbeddingAdapter;

  constructor(adapter: EmbeddingAdapter) {
    this.adapter = adapter;
  }

  get dimensions(): number {
    return this.adapter.dimensions;
  }

  async embedEntry(entry: MemoryEntry): Promise<number[]> {
    if (entry.embedding) return entry.embedding;
    const embedding = await this.adapter.embed(entry.content);
    entry.embedding = embedding;
    return embedding;
  }

  async embedEntries(entries: MemoryEntry[]): Promise<number[][]> {
    const toEmbed: { index: number; text: string }[] = [];
    const results: number[][] = new Array(entries.length);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.embedding) {
        results[i] = entry.embedding;
      } else {
        toEmbed.push({ index: i, text: entry.content });
      }
    }

    if (toEmbed.length > 0) {
      const embeddings = await this.adapter.embedBatch(
        toEmbed.map((t) => t.text),
      );
      for (let j = 0; j < toEmbed.length; j++) {
        const idx = toEmbed[j]!.index;
        const embedding = embeddings[j]!;
        results[idx] = embedding;
        entries[idx]!.embedding = embedding;
      }
    }

    return results;
  }

  async embedText(text: string): Promise<number[]> {
    return this.adapter.embed(text);
  }
}
