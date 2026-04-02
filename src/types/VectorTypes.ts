export interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}

export interface VectorEntry {
  id: string;
  agentId: string;
  content: string;
  embedding: number[];
  metadata?: Record<string, unknown>;
  timestamp: Date;
  memoryEntryId?: string;
}

export interface VectorSearchResult {
  entry: VectorEntry;
  score: number;
}

export interface VectorQuery {
  agentId: string;
  text?: string;
  embedding?: number[];
  topK?: number;
  minScore?: number;
  filter?: Record<string, unknown>;
}

export interface VectorStore {
  upsert(entry: VectorEntry): Promise<void>;
  upsertBatch(entries: VectorEntry[]): Promise<void>;
  search(query: VectorQuery): Promise<VectorSearchResult[]>;
  delete(agentId: string, ids: string[]): Promise<void>;
  clear(agentId: string): Promise<void>;
}
