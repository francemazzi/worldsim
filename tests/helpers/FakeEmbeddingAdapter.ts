import type { EmbeddingAdapter } from "../../src/types/VectorTypes.js";

/**
 * Deterministic hash-based embedding adapter for testing.
 * Produces repeatable embeddings from text content so that
 * cosine-similarity tests are predictable.
 */
export class FakeEmbeddingAdapter implements EmbeddingAdapter {
  readonly dimensions: number;

  constructor(dimensions = 8) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    return this.hashToVector(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.hashToVector(t));
  }

  private hashToVector(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      vec[i % this.dimensions] += code;
    }
    // normalise to unit vector
    const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / mag);
  }
}
