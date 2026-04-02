import type { MemoryEntry } from "./MemoryTypes.js";
import type { AgentConfig, AgentInternalState } from "./AgentTypes.js";

export interface PersistedAgentConfig {
  id: string;
  worldId: string;
  config: AgentConfig;
  createdAt: Date;
  updatedAt: Date;
}

export interface StateSnapshot {
  id: string;
  agentId: string;
  worldId: string;
  tick: number;
  state: AgentInternalState;
  timestamp: Date;
}

export interface ConversationRecord {
  id: string;
  worldId: string;
  tick: number;
  fromAgentId: string;
  toAgentId: string | null;
  content: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
}

export interface ConsolidatedKnowledge {
  id: string;
  agentId: string;
  worldId: string;
  summary: string;
  sourceMemoryIds: string[];
  importance: number;
  category?: string;
  createdAt: Date;
}

export interface PersistenceStore {
  saveAgentConfig(config: PersistedAgentConfig): Promise<void>;
  getAgentConfig(
    agentId: string,
    worldId: string,
  ): Promise<PersistedAgentConfig | null>;
  listAgentConfigs(worldId: string): Promise<PersistedAgentConfig[]>;

  saveMemoryEntry(entry: MemoryEntry & { worldId: string }): Promise<void>;
  saveMemoryEntries(
    entries: (MemoryEntry & { worldId: string })[],
  ): Promise<void>;
  getMemoryEntries(
    agentId: string,
    worldId: string,
    opts?: {
      since?: Date;
      before?: Date;
      types?: MemoryEntry["type"][];
      limit?: number;
      offset?: number;
    },
  ): Promise<MemoryEntry[]>;
  deleteMemoryEntries(ids: string[]): Promise<void>;
  countMemoryEntries(agentId: string, worldId: string): Promise<number>;

  saveStateSnapshot(snapshot: StateSnapshot): Promise<void>;
  getLatestState(
    agentId: string,
    worldId: string,
  ): Promise<StateSnapshot | null>;
  getStateHistory(
    agentId: string,
    worldId: string,
    limit?: number,
  ): Promise<StateSnapshot[]>;

  saveConversation(record: ConversationRecord): Promise<void>;
  getConversations(
    worldId: string,
    opts?: {
      agentId?: string;
      sinceTick?: number;
      limit?: number;
    },
  ): Promise<ConversationRecord[]>;

  saveKnowledge(knowledge: ConsolidatedKnowledge): Promise<void>;
  getKnowledge(
    agentId: string,
    worldId: string,
  ): Promise<ConsolidatedKnowledge[]>;
  deleteKnowledge(ids: string[]): Promise<void>;
}
