export { WorldEngine } from "./engine/WorldEngine.js";
export { ConsoleLoggerPlugin } from "./plugins/built-in/ConsoleLoggerPlugin.js";
export { OpenAICompatAdapter } from "./llm/OpenAICompatAdapter.js";
export { BrainMemory } from "./memory/BrainMemory.js";
export type { RecallOptions, RecallResult } from "./memory/BrainMemory.js";
export { MemoryConsolidator } from "./memory/MemoryConsolidator.js";
export { EmbeddingManager } from "./memory/EmbeddingManager.js";

export type {
  WorldConfig,
  WorldContext,
  WorldStatus,
  WorldEvent,
  LLMConfig,
} from "./types/WorldTypes.js";
export type {
  AgentConfig,
  AgentAction,
  AgentRole,
  AgentStatus,
  AgentControlEvent,
  AgentMessage,
  AgentProfile,
  AgentInternalState,
} from "./types/AgentTypes.js";
export type { RuleSet, Rule, RulesContext } from "./types/RulesTypes.js";
export type { WorldSimPlugin, AgentTool } from "./types/PluginTypes.js";
export type {
  MemoryStore,
  MemoryEntry,
  MemoryQuery,
} from "./types/MemoryTypes.js";
export type {
  GraphStore,
  Relationship,
  GraphQuery,
  RelationshipUpsert,
} from "./types/GraphTypes.js";
export type {
  LLMAdapter,
  LLMResponse,
  ChatOptions,
  ToolCall,
} from "./llm/LLMAdapter.js";
export type {
  VectorStore,
  VectorEntry,
  VectorQuery,
  VectorSearchResult,
  EmbeddingAdapter,
} from "./types/VectorTypes.js";
export type {
  PersistenceStore,
  PersistedAgentConfig,
  StateSnapshot,
  ConversationRecord,
  ConsolidatedKnowledge,
} from "./types/PersistenceTypes.js";
export type {
  ConsolidationConfig,
  ConsolidationResult,
  ImportanceScore,
} from "./types/ConsolidationTypes.js";

// Scalability modules
export { ActivityScheduler } from "./scheduling/ActivityScheduler.js";
export { TokenBudgetTracker } from "./scheduling/TokenBudgetTracker.js";
export type { TokenBudgetResult } from "./scheduling/TokenBudgetTracker.js";
export { BatchExecutor } from "./engine/BatchExecutor.js";
export { CircularBuffer } from "./engine/CircularBuffer.js";
export { LLMAdapterPool } from "./llm/LLMAdapterPool.js";
export { ResponseCache } from "./llm/ResponseCache.js";
export { LocationIndex } from "./location/LocationIndex.js";
export type { NearbyResult } from "./location/LocationIndex.js";
export { ConversationManager } from "./messaging/ConversationManager.js";
export type { CanSpeakResult } from "./messaging/ConversationManager.js";
export { NeighborhoodManager } from "./graph/NeighborhoodManager.js";
export type { NeighborhoodConfig } from "./graph/NeighborhoodManager.js";
export type {
  ActivitySchedule,
  TokenBudget,
  TokenUsage,
} from "./types/ScheduleTypes.js";
export type {
  GeoLocation,
  LocationConfig,
} from "./types/LocationTypes.js";
export type {
  Conversation,
  ConversationTurn,
} from "./types/ConversationTypes.js";
