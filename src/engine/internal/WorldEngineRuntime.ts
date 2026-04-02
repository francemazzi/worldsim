import { WorldClock } from "../WorldClock.js";
import { AgentRegistry } from "../../agents/AgentRegistry.js";
import { ControlAgent } from "../../agents/ControlAgent.js";
import { PersonAgent } from "../../agents/PersonAgent.js";
import { MessageBus } from "../../messaging/MessageBus.js";
import { PluginRegistry } from "../../plugins/PluginRegistry.js";
import { LLMAdapterPool } from "../../llm/LLMAdapterPool.js";
import { BatchExecutor } from "../BatchExecutor.js";
import { CircularBuffer } from "../CircularBuffer.js";
import { ActivityScheduler } from "../../scheduling/ActivityScheduler.js";
import { TokenBudgetTracker } from "../../scheduling/TokenBudgetTracker.js";
import { NeighborhoodManager } from "../../graph/NeighborhoodManager.js";
import { ConversationManager } from "../../messaging/ConversationManager.js";
import { LocationIndex } from "../../location/LocationIndex.js";
import { BrainMemory } from "../../memory/BrainMemory.js";
import type {
  WorldConfig,
  WorldContext,
  WorldStatus,
  WorldEvent,
} from "../../types/WorldTypes.js";
import type { AgentConfig } from "../../types/AgentTypes.js";
import type { RulesContext } from "../../types/RulesTypes.js";

export type TickHandler = (tick: number) => void;

export interface WorldEngineRuntime {
  status: WorldStatus;
  config: WorldConfig;
  context: WorldContext;
  agentRegistry: AgentRegistry;
  messageBus: MessageBus;
  rulesContext: RulesContext | null;
  pluginRegistry: PluginRegistry;
  llmPool: LLMAdapterPool;
  clock: WorldClock;
  controlAgents: ControlAgent[];
  personAgents: PersonAgent[];
  eventLog: CircularBuffer<WorldEvent>;
  pendingAgentConfigs: AgentConfig[];
  tickHandlers: TickHandler[];
  brainMemory?: BrainMemory | undefined;
  batchExecutor: BatchExecutor;
  activityScheduler: ActivityScheduler;
  tokenBudgetTracker: TokenBudgetTracker;
  neighborhoodManager: NeighborhoodManager;
  conversationManager: ConversationManager;
  locationIndex: LocationIndex;
}
