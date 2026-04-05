// ─── Primary API ────────────────────────────────────────────────────
export { WorldEngine } from "./engine/WorldEngine.js";
export { ConsoleLoggerPlugin } from "./plugins/built-in/ConsoleLoggerPlugin.js";
export { LifeSkillsPlugin } from "./plugins/built-in/LifeSkillsPlugin.js";
export type { SkillCategory } from "./plugins/built-in/LifeSkillsPlugin.js";
export { reportGeneratorPlugin } from "./plugins/built-in/ReportGeneratorPlugin.js";
export type { ReportGeneratorOptions } from "./plugins/built-in/ReportGeneratorPlugin.js";
export { RealWorldToolsPlugin } from "./plugins/built-in/RealWorldToolsPlugin.js";
export type { RealWorldToolsOptions, RealWorldDataSources, WeatherDataSource, NewsDataSource, EnvironmentDataSource } from "./plugins/built-in/RealWorldToolsPlugin.js";
export { RelationshipPlugin } from "./plugins/built-in/RelationshipPlugin.js";
export type { RelationshipPluginOptions, RelationshipMeta } from "./plugins/built-in/RelationshipPlugin.js";
export { AssetPlugin } from "./plugins/built-in/AssetPlugin.js";
export type { AssetPluginOptions } from "./plugins/built-in/AssetPlugin.js";
export { MovementPlugin } from "./plugins/built-in/MovementPlugin.js";
export type { MovementPluginOptions, MovementRecord } from "./types/MovementTypes.js";
export { ChatPlugin } from "./plugins/built-in/ChatPlugin.js";
export type { ChatPluginOptions } from "./plugins/built-in/ChatPlugin.js";
export { OpenAICompatAdapter } from "./llm/OpenAICompatAdapter.js";

// ─── Core Types ─────────────────────────────────────────────────────
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

// ─── Report Types ───────────────────────────────────────────────────
export type {
  SimulationReport,
  SimulationSummary,
  TimelineEntry,
  AgentReport,
  AgentTickSnapshot,
  ActionDistribution,
  RelationshipEvolution,
  SimulationMetrics,
  TopicInsight,
  LiveReportResponse,
  StoredRunSummary,
  ReportCompareResponse,
} from "./types/ReportTypes.js";

// ─── Stores (zero-dependency) ───────────────────────────────────────
export { InMemoryMemoryStore } from "./stores/InMemoryMemoryStore.js";
export { InMemoryGraphStore } from "./stores/InMemoryGraphStore.js";

// ─── Studio & Streaming ────────────────────────────────────────────
export { studioPlugin } from "./studio/StudioPlugin.js";
export type { StudioOptions } from "./studio/StudioConfig.js";
export { WorldSimServer } from "./streaming/WorldSimServer.js";
export type { WorldSimServerOptions } from "./streaming/WorldSimServer.js";
export { SocketIOStreamPlugin } from "./streaming/SocketIOStreamPlugin.js";
export type {
  ServerToClientEvents,
  ClientToServerEvents,
  TickEvent,
  AgentActionEvent,
  AgentStatusEvent,
  MessageEvent,
  AgentStateEvent,
  AgentSnapshot,
  WorldSnapshot,
  AgentMovedEvent,
} from "./streaming/types.js";
export type {
  ChatMessage,
  ChatSession,
  ChatSendPayload,
  ChatResponsePayload,
  ChatStreamChunk,
  ChatHistoryPayload,
} from "./types/ChatTypes.js";

// ─── Scenario Loader ────────────────────────────────────────────────
export { loadScenario } from "./studio/ScenarioLoader.js";
export type { ScenarioConfig, ScenarioAgentConfig, ScenarioResult } from "./studio/ScenarioLoader.js";

// ─── Asset Types ────────────────────────────────────────────────────
export type {
  Asset,
  AssetType,
  Venue,
  VenueType,
  Household,
  AssetStore,
  AssetLocation,
} from "./types/AssetTypes.js";

// ─── Stores (zero-dependency) — Assets ──────────────────────────────
export { InMemoryAssetStore } from "./stores/InMemoryAssetStore.js";

// ─── Store Interfaces ───────────────────────────────────────────────
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
  RelationshipTypeDefinition,
} from "./types/GraphTypes.js";
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

// ─── Advanced: LLM ─────────────────────────────────────────────────
export type {
  LLMAdapter,
  LLMResponse,
  ChatOptions,
  ToolCall,
} from "./llm/LLMAdapter.js";
export { LLMAdapterPool } from "./llm/LLMAdapterPool.js";
export { ResponseCache } from "./llm/ResponseCache.js";

// ─── Advanced: Memory & Consolidation ───────────────────────────────
export { BrainMemory } from "./memory/BrainMemory.js";
export type { RecallOptions, RecallResult } from "./memory/BrainMemory.js";
export { MemoryConsolidator } from "./memory/MemoryConsolidator.js";
export { EmbeddingManager } from "./memory/EmbeddingManager.js";
export type {
  ConsolidationConfig,
  ConsolidationResult,
  ImportanceScore,
} from "./types/ConsolidationTypes.js";

// ─── Advanced: Scheduling & Scalability ─────────────────────────────
export { ActivityScheduler } from "./scheduling/ActivityScheduler.js";
export { TokenBudgetTracker } from "./scheduling/TokenBudgetTracker.js";
export type { TokenBudgetResult } from "./scheduling/TokenBudgetTracker.js";
export { BatchExecutor } from "./engine/BatchExecutor.js";
export { CircularBuffer } from "./engine/CircularBuffer.js";
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

// ─── Production Stores (peer dependencies) ──────────────────────────
export { RedisMemoryStore } from "./stores/RedisMemoryStore.js";
export { Neo4jGraphStore } from "./stores/Neo4jGraphStore.js";
export { PgVectorStore } from "./stores/PgVectorStore.js";
export { PgPersistenceStore } from "./stores/PgPersistenceStore.js";
export { OpenAIEmbeddingAdapter } from "./stores/OpenAIEmbeddingAdapter.js";

// ─── Skill Resolver ─────────────────────────────────────────────────
export { resolveToolNames } from "./plugins/built-in/skillResolver.js";
