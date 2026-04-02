export interface MemoryEntry {
  id: string;
  agentId: string;
  tick: number;
  type: "action" | "observation" | "conversation" | "reflection" | "knowledge";
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  importance?: number;
  embedding?: number[];
}

export interface MemoryQuery {
  agentId: string;
  limit?: number;
  types?: MemoryEntry["type"][];
  since?: number;
  search?: string;
}

export interface MemoryStore {
  save(entry: MemoryEntry): Promise<void>;
  saveBatch(entries: MemoryEntry[]): Promise<void>;
  query(query: MemoryQuery): Promise<MemoryEntry[]>;
  getRecent(agentId: string, limit: number): Promise<MemoryEntry[]>;
  clear(agentId: string): Promise<void>;
}
