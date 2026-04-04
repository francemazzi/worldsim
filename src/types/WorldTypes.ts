import type { MemoryStore } from "./MemoryTypes.js";
import type { GraphStore } from "./GraphTypes.js";
import type { VectorStore, EmbeddingAdapter } from "./VectorTypes.js";
import type { PersistenceStore } from "./PersistenceTypes.js";
import type { ConsolidationConfig } from "./ConsolidationTypes.js";
import type { AssetStore } from "./AssetTypes.js";

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
  /**
   * Default fraction of ticks where agents without a schedule are active (0.0-1.0).
   * Applied as a world-level gate in the TickOrchestrator.
   * Agents with pending messages bypass this gate.
   * Default: 1.0 (all agents active every tick — set to 0.1 for 10k+ agents).
   */
  defaultActiveTickRatio?: number | undefined;
  llm: LLMConfig;
  rulesPath?: {
    json?: string[] | undefined;
    pdf?: string[] | undefined;
  } | undefined;
  memoryStore?: MemoryStore | undefined;
  graphStore?: GraphStore | undefined;
  vectorStore?: VectorStore | undefined;
  embeddingAdapter?: EmbeddingAdapter | undefined;
  persistenceStore?: PersistenceStore | undefined;
  assetStore?: AssetStore | undefined;
  consolidation?: Partial<ConsolidationConfig> | undefined;
  /**
   * LLM config for "light" tier agents (e.g. gpt-4o-mini).
   * Agents with `llmTier: "light"` use this config instead of the main `llm`.
   * If not set, light-tier agents fall back to the main `llm` config.
   */
  lightLlm?: LLMConfig | undefined;
  /**
   * Maximum number of events kept in the in-memory event log.
   * Uses a circular buffer — oldest events are discarded when full.
   * Default: 10,000.
   */
  eventLogMaxSize?: number | undefined;
  /**
   * Default radius (km) for proximity-based messaging when agents lack
   * neighborhood config. Agents without location or with radius 0 fall back
   * to global broadcast. Default: 0 (broadcast, backward-compatible).
   */
  defaultBroadcastRadius?: number | undefined;
  /**
   * Fraction of non-safe actions evaluated by ControlAgent per tick (0.0-1.0).
   * Actions not sampled are auto-approved. Default: 1.0 (evaluate all).
   * Set to 0.1-0.3 at scale to reduce ControlAgent LLM calls by 70-90%.
   */
  controlSamplingRate?: number | undefined;
  /**
   * Enables LLM response caching for chat calls (not tool calls).
   * Responses are cached by message content hash and expire after `responseCacheTtl` ticks.
   * Default: false (disabled).
   */
  enableResponseCache?: boolean | undefined;
  /** TTL in ticks for cached LLM responses. Default: 5. */
  responseCacheTtl?: number | undefined;
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
