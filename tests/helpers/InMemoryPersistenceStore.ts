import type {
  PersistenceStore,
  PersistedAgentConfig,
  StateSnapshot,
  ConversationRecord,
  ConsolidatedKnowledge,
} from "../../src/types/PersistenceTypes.js";
import type { MemoryEntry } from "../../src/types/MemoryTypes.js";

export class InMemoryPersistenceStore implements PersistenceStore {
  private agentConfigs: Map<string, PersistedAgentConfig> = new Map();
  private memoryEntries: Map<string, MemoryEntry & { worldId: string }> =
    new Map();
  private stateSnapshots: StateSnapshot[] = [];
  private conversations: ConversationRecord[] = [];
  private knowledge: Map<string, ConsolidatedKnowledge> = new Map();

  // --- Agent config ---

  async saveAgentConfig(config: PersistedAgentConfig): Promise<void> {
    this.agentConfigs.set(`${config.id}::${config.worldId}`, config);
  }

  async getAgentConfig(
    agentId: string,
    worldId: string,
  ): Promise<PersistedAgentConfig | null> {
    return this.agentConfigs.get(`${agentId}::${worldId}`) ?? null;
  }

  async listAgentConfigs(worldId: string): Promise<PersistedAgentConfig[]> {
    return Array.from(this.agentConfigs.values()).filter(
      (c) => c.worldId === worldId,
    );
  }

  // --- Memory entries ---

  async saveMemoryEntry(
    entry: MemoryEntry & { worldId: string },
  ): Promise<void> {
    this.memoryEntries.set(entry.id, entry);
  }

  async saveMemoryEntries(
    entries: (MemoryEntry & { worldId: string })[],
  ): Promise<void> {
    for (const e of entries) {
      this.memoryEntries.set(e.id, e);
    }
  }

  async getMemoryEntries(
    agentId: string,
    worldId: string,
    opts?: {
      since?: Date;
      before?: Date;
      types?: MemoryEntry["type"][];
      limit?: number;
      offset?: number;
    },
  ): Promise<MemoryEntry[]> {
    let results = Array.from(this.memoryEntries.values()).filter(
      (e) => e.agentId === agentId && e.worldId === worldId,
    );

    if (opts?.types && opts.types.length > 0) {
      results = results.filter((e) => opts.types!.includes(e.type));
    }
    if (opts?.since) {
      const since = opts.since.getTime();
      results = results.filter((e) => e.timestamp.getTime() >= since);
    }
    if (opts?.before) {
      const before = opts.before.getTime();
      results = results.filter((e) => e.timestamp.getTime() < before);
    }

    results.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );

    const offset = opts?.offset ?? 0;
    if (offset > 0) results = results.slice(offset);
    if (opts?.limit != null) results = results.slice(0, opts.limit);

    return results;
  }

  async deleteMemoryEntries(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.memoryEntries.delete(id);
    }
  }

  async countMemoryEntries(agentId: string, worldId: string): Promise<number> {
    return Array.from(this.memoryEntries.values()).filter(
      (e) => e.agentId === agentId && e.worldId === worldId,
    ).length;
  }

  // --- State snapshots ---

  async saveStateSnapshot(snapshot: StateSnapshot): Promise<void> {
    this.stateSnapshots.push(snapshot);
  }

  async getLatestState(
    agentId: string,
    worldId: string,
  ): Promise<StateSnapshot | null> {
    const filtered = this.stateSnapshots
      .filter((s) => s.agentId === agentId && s.worldId === worldId)
      .sort((a, b) => b.tick - a.tick);
    return filtered[0] ?? null;
  }

  async getStateHistory(
    agentId: string,
    worldId: string,
    limit?: number,
  ): Promise<StateSnapshot[]> {
    const filtered = this.stateSnapshots
      .filter((s) => s.agentId === agentId && s.worldId === worldId)
      .sort((a, b) => b.tick - a.tick);
    return limit != null ? filtered.slice(0, limit) : filtered;
  }

  // --- Conversations ---

  async saveConversation(record: ConversationRecord): Promise<void> {
    this.conversations.push(record);
  }

  async getConversations(
    worldId: string,
    opts?: {
      agentId?: string;
      sinceTick?: number;
      limit?: number;
    },
  ): Promise<ConversationRecord[]> {
    let results = this.conversations.filter((c) => c.worldId === worldId);

    if (opts?.agentId) {
      results = results.filter(
        (c) =>
          c.fromAgentId === opts.agentId || c.toAgentId === opts.agentId,
      );
    }
    if (opts?.sinceTick != null) {
      results = results.filter((c) => c.tick >= opts.sinceTick!);
    }

    results.sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );

    if (opts?.limit != null) results = results.slice(0, opts.limit);
    return results;
  }

  // --- Consolidated knowledge ---

  async saveKnowledge(knowledge: ConsolidatedKnowledge): Promise<void> {
    this.knowledge.set(knowledge.id, knowledge);
  }

  async getKnowledge(
    agentId: string,
    worldId: string,
  ): Promise<ConsolidatedKnowledge[]> {
    return Array.from(this.knowledge.values())
      .filter((k) => k.agentId === agentId && k.worldId === worldId)
      .sort((a, b) => b.importance - a.importance);
  }

  async deleteKnowledge(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.knowledge.delete(id);
    }
  }

  // --- Test helpers ---

  getAllMemoryEntries(): (MemoryEntry & { worldId: string })[] {
    return Array.from(this.memoryEntries.values());
  }

  getAllKnowledge(): ConsolidatedKnowledge[] {
    return Array.from(this.knowledge.values());
  }
}
