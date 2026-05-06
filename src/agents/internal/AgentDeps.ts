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

export interface AgentTimelineDeps {
  timeline?: IntraTickTimeline | undefined;
}
