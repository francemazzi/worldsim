import OpenAI from "openai";
import type { EmbeddingAdapter } from "../../../src/types/VectorTypes.js";

export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  private client: OpenAI;
  private model: string;
  readonly dimensions: number;

  constructor(options?: {
    apiKey?: string;
    model?: string;
    dimensions?: number;
  }) {
    this.client = new OpenAI({
      apiKey: options?.apiKey ?? process.env["OPENAI_API_KEY"],
    });
    this.model = options?.model ?? "text-embedding-3-small";
    this.dimensions = options?.dimensions ?? 1536;
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
      dimensions: this.dimensions,
    });
    return response.data[0]!.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dimensions,
    });
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }
}
