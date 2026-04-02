export interface ConsolidationConfig {
  retentionDays: number;
  importanceThreshold: number;
  batchSize: number;
  scoringStrategy: "llm" | "heuristic" | "hybrid";
  generateSummaries: boolean;
}

export interface ConsolidationResult {
  agentId: string;
  processed: number;
  promoted: number;
  summarized: number;
  deleted: number;
  duration: number;
}

export interface ImportanceScore {
  memoryId: string;
  score: number;
  reasoning?: string;
}
