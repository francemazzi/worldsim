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
export { defaultMovementPolicy } from "./plugins/built-in/movement/MovementPolicy.js";
export type {
  MovementPolicy,
  MovementRequest,
  MovementDecision,
  DefaultMovementPolicyOptions,
} from "./plugins/built-in/movement/MovementPolicy.js";
export { PhonePlugin } from "./plugins/built-in/PhonePlugin.js";
export type { PhonePluginOptions } from "./plugins/built-in/PhonePlugin.js";
export {
  PhoneDirectory,
  createPhoneAsset,
  getAgentPhone,
  getPhoneMetadata,
  isPhoneAsset,
  PHONE_ASSET_KIND,
} from "./messaging/phone/PhoneDirectory.js";
export type {
  PhoneContact,
  PhoneMetadata,
  CreatePhoneAssetInput,
} from "./messaging/phone/PhoneDirectory.js";
export type { Message, MessageType, PhoneMessageMetadata } from "./messaging/Message.js";
export { ChatPlugin } from "./plugins/built-in/ChatPlugin.js";
export type { ChatPluginOptions } from "./plugins/built-in/ChatPlugin.js";
export { privacyCompliancePlugin } from "./plugins/built-in/PrivacyCompliancePlugin.js";
export type { PrivacyCompliancePluginOptions } from "./plugins/built-in/PrivacyCompliancePlugin.js";
export { OpenAICompatAdapter } from "./llm/OpenAICompatAdapter.js";

// ─── MCP Client Support ────────────────────────────────────────────
export type { McpServerConfig } from "./types/AgentTypes.js";
export { McpClientManager } from "./mcp/McpClientManager.js";
export { wrapMcpTool, listAndWrapMcpTools } from "./mcp/McpToolAdapter.js";

// ─── Core Types ─────────────────────────────────────────────────────
export type {
  WorldConfig,
  WorldContext,
  WorldStatus,
  WorldEvent,
  LLMConfig,
} from "./types/WorldTypes.js";
export type {
  PrivacyConsentMode,
  PrivacyDataCategory,
  PrivacyRedactionLevel,
  PrivacyConsentStatus,
  PrivacyCategoryRule,
  WorldPrivacyConfig,
  TokenPriceConfig,
  CostLatencyAlertConfig,
  ObservabilityConfig,
} from "./types/PrivacyTypes.js";
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
export type {
  TimelineStamp,
  TimelineMetadata,
  ThinkingDelayConfig,
} from "./types/TimelineTypes.js";
export type { RuleSet, Rule, RulesContext } from "./types/RulesTypes.js";
export type { WorldSimPlugin, AgentTool } from "./types/PluginTypes.js";
export type { PositionProvider } from "./plugins/capabilities/PositionProvider.js";
export { isPositionProvider } from "./plugins/capabilities/PositionProvider.js";
export type {
  ConfigurablePlugin,
  PluginRuntimeContext,
} from "./plugins/capabilities/ConfigurablePlugin.js";
export { isConfigurablePlugin } from "./plugins/capabilities/ConfigurablePlugin.js";

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

// ─── Social Types ───────────────────────────────────────────────────
export type {
  Group,
  Gathering,
  GatheringParticipant,
  GatheringQuery,
  GatheringStatus,
  GroupStore,
  GatheringStore,
  RsvpState,
} from "./types/SocialTypes.js";

// ─── Stores (zero-dependency) — Social ──────────────────────────────
export { InMemoryGroupStore, InMemoryGatheringStore } from "./stores/InMemorySocialStores.js";

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
  PrivacyConsentRecord,
  PrivacyPolicyAuditRecord,
  AgentStorageUsage,
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
export type { CanSpeakResult, StartCallOptions } from "./messaging/ConversationManager.js";
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
// ─── Realistic Simulation Primitives ──────────────────────────────
export type {
  Stimulus,
  StimulusKind,
  StimulusSource,
  PerceptionChannel,
} from "./types/StimulusTypes.js";
export type {
  Percept,
  SenseConfig,
  PerceptionFilter,
  AttentionConfig,
} from "./types/PerceptionTypes.js";
export type {
  Entity,
  EntityKind,
  EntityState,
  EntityEmitter,
  EntityRegistry,
} from "./types/EntityTypes.js";
export type {
  Need,
  NeedsState,
  NeedsTemplate,
} from "./types/NeedsTypes.js";
export type {
  Affordance,
  AffordanceMap,
} from "./types/AffordanceTypes.js";
export type { InteractionConfig } from "./types/WorldTypes.js";
export { StimulusBus, createStimulusId } from "./perception/StimulusBus.js";
export { PerceptionEngine } from "./perception/PerceptionEngine.js";
export type {
  PerceptionEngineDeps,
  EntityPositionResolver,
} from "./perception/PerceptionEngine.js";
export { AttentionPolicy } from "./perception/AttentionPolicy.js";
export type {
  RankedPercept,
  SalienceBreakdown,
  AttentionContext,
} from "./perception/AttentionPolicy.js";
export { TopicTracker } from "./perception/TopicTracker.js";
export type { Topic, TopicTrackerOptions } from "./perception/TopicTracker.js";
export { NeedsTracker } from "./needs/NeedsTracker.js";
export { InMemoryEntityRegistry } from "./entities/InMemoryEntityRegistry.js";
export { AffordanceResolver } from "./entities/AffordanceResolver.js";
export type { AvailableAffordance, AffordanceResolverDeps } from "./entities/AffordanceResolver.js";
export type {
  Conversation,
  ConversationTurn,
  ConversationKind,
  ConversationMetadata,
} from "./types/ConversationTypes.js";

// ─── Production Stores (peer dependencies) ──────────────────────────
export { RedisMemoryStore } from "./stores/RedisMemoryStore.js";
export { Neo4jGraphStore } from "./stores/Neo4jGraphStore.js";
export { PgVectorStore } from "./stores/PgVectorStore.js";
export { PgPersistenceStore } from "./stores/PgPersistenceStore.js";
export { OpenAIEmbeddingAdapter } from "./stores/OpenAIEmbeddingAdapter.js";

// ─── Skill Resolver ─────────────────────────────────────────────────
export { resolveToolNames } from "./plugins/built-in/skillResolver.js";

// ─── Federation (multi-world) ──────────────────────────────────────
// Re-exports of the same surface as `worldsim/federation` for ergonomic
// access from a single import. The dedicated sub-export remains the
// canonical way to consume federation types in tree-shakable builds.
export type {
  FederatedAgentId,
  WorldCapability,
  WorldNode,
  CrossWorldChannel,
  CrossWorldEnvelope,
  Unsubscribe as FederationUnsubscribe,
  FederationTransport,
  FederatedAgentDirectory,
  FederatedAgentDirectoryEntry,
  FederatedAgentDirectoryQuery,
  TravelMap,
  TravelEdge,
  TravelOption,
  TravelMode,
  FederationConfig,
} from "./federation/types.js";
export { FederationBus } from "./federation/FederationBus.js";
export { FederationInboundQueue } from "./federation/FederationInboundQueue.js";
export { InMemoryFederationTransport } from "./federation/InMemoryFederationTransport.js";
export { RedisFederationTransport } from "./federation/RedisFederationTransport.js";
export { FederationPlugin } from "./plugins/built-in/FederationPlugin.js";
export type { FederationPluginOptions } from "./plugins/built-in/FederationPlugin.js";
export type { CrossWorldMessageDirection } from "./types/PluginTypes.js";
