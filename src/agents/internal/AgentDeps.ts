import type { MemoryStore } from "../../types/MemoryTypes.js";
import type { GraphStore } from "../../types/GraphTypes.js";
import type { VectorStore, EmbeddingAdapter } from "../../types/VectorTypes.js";
import type { PersistenceStore } from "../../types/PersistenceTypes.js";
import type { AssetStore } from "../../types/AssetTypes.js";
import type { BrainMemory } from "../../memory/BrainMemory.js";
import type { ActivityScheduler } from "../../scheduling/ActivityScheduler.js";
import type { TokenBudgetTracker } from "../../scheduling/TokenBudgetTracker.js";
import type { NeighborhoodManager } from "../../graph/NeighborhoodManager.js";
import type { ConversationManager } from "../../messaging/ConversationManager.js";
import type { LocationIndex } from "../../location/LocationIndex.js";
import type { IntraTickTimeline } from "../../engine/IntraTickTimeline.js";
import type { StimulusBus } from "../../perception/StimulusBus.js";
import type { PerceptionEngine } from "../../perception/PerceptionEngine.js";
import type { TopicTracker } from "../../perception/TopicTracker.js";
import type { NeedsTracker } from "../../needs/NeedsTracker.js";

/**
 * Persistence / recall-related dependencies. Everything an agent may need
 * to read/write its long-term state.
 */
export interface AgentStorageDeps {
  memoryStore?: MemoryStore | undefined;
  graphStore?: GraphStore | undefined;
  vectorStore?: VectorStore | undefined;
  persistenceStore?: PersistenceStore | undefined;
  embeddingAdapter?: EmbeddingAdapter | undefined;
  assetStore?: AssetStore | undefined;
  brainMemory?: BrainMemory | undefined;
}

/**
 * Scheduling and budget-related dependencies that gate per-tick execution.
 */
export interface AgentSchedulingDeps {
  activityScheduler?: ActivityScheduler | undefined;
  tokenBudgetTracker?: TokenBudgetTracker | undefined;
}

/**
 * Social / spatial dependencies that drive message routing between agents.
 */
export interface AgentSocialDeps {
  neighborhoodManager?: NeighborhoodManager | undefined;
  conversationManager?: ConversationManager | undefined;
  locationIndex?: LocationIndex | undefined;
  /** Radius in km for proximity-based messaging. 0 = no proximity fallback. */
  defaultBroadcastRadius?: number | undefined;
}

/**
 * Realistic Simulation deps. When provided, the MessageRouter routes
 * `speak` actions through the perception layer instead of (or alongside)
 * the legacy cascade.
 */
export interface AgentPerceptionDeps {
  stimulusBus?: StimulusBus | undefined;
  perceptionEngine?: PerceptionEngine | undefined;
  /** When true, fall through to legacy routing if no perceivers found. */
  perceptionFallbackToLegacy?: boolean | undefined;
  /**
   * Topic tracker shared by the world. When provided, the agent can frame
   * its replies as part of an existing thread and the prompt builder
   * surfaces an active "FILO DISCORSIVO" section.
   */
  topicTracker?: TopicTracker | undefined;
  /**
   * Needs tracker shared by the world. When provided, the agent's prompt
   * surfaces active needs and `isIdle` consults critical needs to decide
   * whether to skip the LLM call.
   */
  needsTracker?: NeedsTracker | undefined;
}

export interface AgentTimelineDeps {
  timeline?: IntraTickTimeline | undefined;
}
