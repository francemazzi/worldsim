import type { MemoryStore } from "./MemoryTypes.js";
import type { GraphStore } from "./GraphTypes.js";
import type { VectorStore, EmbeddingAdapter } from "./VectorTypes.js";
import type { PersistenceStore } from "./PersistenceTypes.js";
import type { ConsolidationConfig } from "./ConsolidationTypes.js";
import type { AssetStore } from "./AssetTypes.js";
import type { GroupStore, GatheringStore } from "./SocialTypes.js";
import type { WorldPrivacyConfig, ObservabilityConfig } from "./PrivacyTypes.js";
import type { MovementPolicy } from "../plugins/built-in/movement/MovementPolicy.js";
import type { FederationConfig } from "../federation/types.js";
import type { TimelineMetadata } from "./TimelineTypes.js";
import type { SenseConfig } from "./PerceptionTypes.js";
import type { NeedsTemplate } from "./NeedsTypes.js";

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
  groupStore?: GroupStore | undefined;
  gatheringStore?: GatheringStore | undefined;
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
  /** Privacy/compliance controls (per-world, integrator-defined profile). */
  privacy?: WorldPrivacyConfig | undefined;
  /** Cost/latency observability configuration (pricing, alert thresholds). */
  observability?: ObservabilityConfig | undefined;
  /**
   * Movement policy used by the built-in MovementPlugin.
   * When omitted, the plugin falls back to `defaultMovementPolicy` — which
   * allows walking within `walkingRadiusMeters` and requires an owned vehicle
   * beyond that radius. Set this to customize for your simulation (public
   * transit, licenses, health/fitness signals, fuel, weather, etc.).
   */
  movementPolicy?: MovementPolicy | undefined;
  /**
   * Walking radius (meters) used by the default movement policy. Ignored
   * when `movementPolicy` is provided. Default: 1500.
   */
  walkingRadiusMeters?: number | undefined;
  /**
   * Multi-world federation. When omitted, the engine behaves exactly as a
   * single isolated world (no transport, no FederationBus, zero overhead).
   * When provided, cross-world routing in MessageBus is enabled and the
   * local world joins the federation through the supplied transport.
   */
  federation?: FederationConfig | undefined;
  /**
   * Realistic-simulation primitives toggle. When omitted (or
   * `mode: "legacy"`), the engine behaves exactly as before: messages flow
   * through the legacy MessageRouter cascade (conversation → neighborhood
   * → proximity → broadcast).
   *
   * When `mode: "perception"`, every `speak` becomes a `Stimulus` going
   * through the PerceptionEngine, agents only see what they actually
   * perceive, and salience drives whether they react. See `Phase 1+` of
   * the Realistic Simulation roadmap for details.
   */
  interaction?: InteractionConfig | undefined;
}

/**
 * Toggle and tuning for the Realistic Simulation primitives layer
 * (Stimulus → Perception → Attention → Causality → Needs → Affordances).
 *
 * All fields are optional. Default behavior is fully backwards compatible
 * (`mode: "legacy"`, no perception layer attached). Phase 1+ of the
 * roadmap progressively wire these knobs to actual engine code.
 */
export interface InteractionConfig {
  /**
   * `"legacy"`     — current behavior, MessageBus cascade routing.
   * `"perception"` — speech and observable events flow through the
   *                  PerceptionEngine; agents only see what their senses
   *                  pick up.
   * Default: `"legacy"`.
   */
  mode?: "legacy" | "perception" | undefined;
  /**
   * In `perception` mode, when an agent emits a stimulus that no perceiver
   * picks up, drop it silently instead of falling back to global broadcast
   * (which is the legacy behavior). Default: `true` in perception mode,
   * `false` in legacy mode (i.e. ignored).
   */
  disableBroadcastFallback?: boolean | undefined;
  /**
   * Hard requirement: every outbound speech must go through perception. If
   * the world has no LocationIndex and no `defaultSenses`, the engine
   * throws on bootstrap instead of silently degrading. Useful for
   * production simulations where silent broadcast would be a bug.
   */
  requirePerception?: boolean | undefined;
  /**
   * Senses applied to agents that don't declare their own. Typical default
   * for a "human-like" simulation:
   *   `[{ channel: "sound", radiusKm: 0.05 },
   *      { channel: "sight", radiusKm: 0.03 },
   *      { channel: "language" }]`.
   */
  defaultSenses?: SenseConfig[] | undefined;
  /**
   * Number of past ticks the perception engine keeps stimuli alive after
   * emission, to allow for end-of-tick decay and audit. Default `1` (only
   * the current tick is queryable).
   */
  stimulusRetentionTicks?: number | undefined;
  /**
   * Window (in ticks) the TopicTracker (Phase 3) uses to cluster stimuli
   * into topics. Default `5`.
   */
  topicWindowTicks?: number | undefined;
  /**
   * Default NeedsTemplate applied to agents that do not declare their own
   * `AgentConfig.needs`. Useful to populate hunger/thirst/fatigue/social
   * across an entire scenario without copy-pasting. Default: undefined
   * (agents have no needs unless they declare them).
   */
  defaultNeedsTemplate?: NeedsTemplate | undefined;
}

export interface LLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  /** Maximum retry attempts for transient provider errors. Default: 3. */
  maxRetries?: number | undefined;
  /** Initial exponential backoff delay in milliseconds. Default: 500. */
  retryInitialDelayMs?: number | undefined;
  /** Maximum retry delay in milliseconds. Default: 8000. */
  retryMaxDelayMs?: number | undefined;
  /** Exponential backoff multiplier. Default: 2. */
  retryBackoffFactor?: number | undefined;
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
  metadata?: TimelineMetadata | undefined;
}
