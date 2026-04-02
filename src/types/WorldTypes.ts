import type { MemoryStore } from "./MemoryTypes.js";
import type { GraphStore } from "./GraphTypes.js";

export interface WorldContext {
  worldId: string;
  tickCount: number;
  startedAt: Date;
  metadata: Record<string, unknown>;
}

export interface WorldConfig {
  worldId?: string | undefined;
  maxTicks?: number | undefined;
  tickIntervalMs?: number | undefined;
  maxConcurrentAgents?: number | undefined;
  llm: LLMConfig;
  rulesPath?: {
    json?: string[] | undefined;
    pdf?: string[] | undefined;
  } | undefined;
  memoryStore?: MemoryStore | undefined;
  graphStore?: GraphStore | undefined;
}

export interface LLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
}

export type WorldStatus =
  | "idle"
  | "bootstrapping"
  | "running"
  | "paused"
  | "stopped";

export interface WorldEvent {
  type: string;
  tick: number;
  agentId?: string | undefined;
  payload: unknown;
  timestamp: Date;
}
