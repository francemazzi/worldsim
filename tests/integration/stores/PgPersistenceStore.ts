import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, gte, lt, inArray, desc, sql } from "drizzle-orm";
import pg from "pg";
import type {
  PersistenceStore,
  PersistedAgentConfig,
  StateSnapshot,
  ConversationRecord,
  ConsolidatedKnowledge,
} from "../../../src/types/PersistenceTypes.js";
import type { MemoryEntry } from "../../../src/types/MemoryTypes.js";
import type { AgentInternalState } from "../../../src/types/AgentTypes.js";
import * as schema from "./schema/tables.js";

export class PgPersistenceStore implements PersistenceStore {
  private db: ReturnType<typeof drizzle>;
  private pool: pg.Pool;

  constructor(connectionString = "postgresql://postgres:testpassword@localhost:5432/worldsim_test") {
    this.pool = new pg.Pool({ connectionString });
    this.db = drizzle(this.pool, { schema });
  }

  // --- Agent configs ---

  async saveAgentConfig(config: PersistedAgentConfig): Promise<void> {
    await this.db
      .insert(schema.agentConfigs)
      .values({
        id: config.id,
        worldId: config.worldId,
        config: config.config,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
      })
      .onConflictDoUpdate({
        target: [schema.agentConfigs.id, schema.agentConfigs.worldId],
        set: {
          config: config.config,
          updatedAt: config.updatedAt,
        },
      });
  }

  async getAgentConfig(
    agentId: string,
    worldId: string,
  ): Promise<PersistedAgentConfig | null> {
    const rows = await this.db
      .select()
      .from(schema.agentConfigs)
      .where(
        and(
          eq(schema.agentConfigs.id, agentId),
          eq(schema.agentConfigs.worldId, worldId),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      worldId: row.worldId,
      config: row.config as PersistedAgentConfig["config"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listAgentConfigs(worldId: string): Promise<PersistedAgentConfig[]> {
    const rows = await this.db
      .select()
      .from(schema.agentConfigs)
      .where(eq(schema.agentConfigs.worldId, worldId));

    return rows.map((row) => ({
      id: row.id,
      worldId: row.worldId,
      config: row.config as PersistedAgentConfig["config"],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  // --- Memory entries ---

  async saveMemoryEntry(
    entry: MemoryEntry & { worldId: string },
  ): Promise<void> {
    await this.db.insert(schema.memoryEntries).values({
      id: entry.id,
      agentId: entry.agentId,
      worldId: entry.worldId,
      tick: entry.tick,
      type: entry.type,
      content: entry.content,
      metadata: entry.metadata ?? null,
      importance: entry.importance ?? null,
      timestamp: entry.timestamp,
    });
  }

  async saveMemoryEntries(
    entries: (MemoryEntry & { worldId: string })[],
  ): Promise<void> {
    if (entries.length === 0) return;
    await this.db.insert(schema.memoryEntries).values(
      entries.map((e) => ({
        id: e.id,
        agentId: e.agentId,
        worldId: e.worldId,
        tick: e.tick,
        type: e.type,
        content: e.content,
        metadata: e.metadata ?? null,
        importance: e.importance ?? null,
        timestamp: e.timestamp,
      })),
    );
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
    const conditions = [
      eq(schema.memoryEntries.agentId, agentId),
      eq(schema.memoryEntries.worldId, worldId),
    ];

    if (opts?.since) {
      conditions.push(gte(schema.memoryEntries.timestamp, opts.since));
    }
    if (opts?.before) {
      conditions.push(lt(schema.memoryEntries.timestamp, opts.before));
    }
    if (opts?.types && opts.types.length > 0) {
      conditions.push(inArray(schema.memoryEntries.type, opts.types));
    }

    let query = this.db
      .select()
      .from(schema.memoryEntries)
      .where(and(...conditions))
      .orderBy(desc(schema.memoryEntries.timestamp));

    if (opts?.offset) {
      query = query.offset(opts.offset);
    }
    if (opts?.limit != null) {
      query = query.limit(opts.limit);
    }

    const rows = await query;
    return rows.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      tick: row.tick,
      type: row.type as MemoryEntry["type"],
      content: row.content,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      importance: row.importance ?? undefined,
      timestamp: row.timestamp,
    }));
  }

  async deleteMemoryEntries(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .delete(schema.memoryEntries)
      .where(inArray(schema.memoryEntries.id, ids));
  }

  async countMemoryEntries(agentId: string, worldId: string): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.memoryEntries)
      .where(
        and(
          eq(schema.memoryEntries.agentId, agentId),
          eq(schema.memoryEntries.worldId, worldId),
        ),
      );
    return result[0]?.count ?? 0;
  }

  // --- State snapshots ---

  async saveStateSnapshot(snapshot: StateSnapshot): Promise<void> {
    await this.db.insert(schema.stateSnapshots).values({
      id: snapshot.id,
      agentId: snapshot.agentId,
      worldId: snapshot.worldId,
      tick: snapshot.tick,
      state: snapshot.state,
      timestamp: snapshot.timestamp,
    });
  }

  async getLatestState(
    agentId: string,
    worldId: string,
  ): Promise<StateSnapshot | null> {
    const rows = await this.db
      .select()
      .from(schema.stateSnapshots)
      .where(
        and(
          eq(schema.stateSnapshots.agentId, agentId),
          eq(schema.stateSnapshots.worldId, worldId),
        ),
      )
      .orderBy(desc(schema.stateSnapshots.tick))
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      agentId: row.agentId,
      worldId: row.worldId,
      tick: row.tick,
      state: row.state as AgentInternalState,
      timestamp: row.timestamp,
    };
  }

  async getStateHistory(
    agentId: string,
    worldId: string,
    limit?: number,
  ): Promise<StateSnapshot[]> {
    let query = this.db
      .select()
      .from(schema.stateSnapshots)
      .where(
        and(
          eq(schema.stateSnapshots.agentId, agentId),
          eq(schema.stateSnapshots.worldId, worldId),
        ),
      )
      .orderBy(desc(schema.stateSnapshots.tick));

    if (limit != null) {
      query = query.limit(limit);
    }

    const rows = await query;
    return rows.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      worldId: row.worldId,
      tick: row.tick,
      state: row.state as AgentInternalState,
      timestamp: row.timestamp,
    }));
  }

  // --- Conversations ---

  async saveConversation(record: ConversationRecord): Promise<void> {
    await this.db.insert(schema.conversations).values({
      id: record.id,
      worldId: record.worldId,
      tick: record.tick,
      fromAgentId: record.fromAgentId,
      toAgentId: record.toAgentId,
      content: record.content,
      metadata: record.metadata ?? null,
      timestamp: record.timestamp,
    });
  }

  async getConversations(
    worldId: string,
    opts?: {
      agentId?: string;
      sinceTick?: number;
      limit?: number;
    },
  ): Promise<ConversationRecord[]> {
    const conditions = [eq(schema.conversations.worldId, worldId)];

    if (opts?.agentId) {
      conditions.push(
        sql`(${schema.conversations.fromAgentId} = ${opts.agentId} OR ${schema.conversations.toAgentId} = ${opts.agentId})`,
      );
    }
    if (opts?.sinceTick != null) {
      conditions.push(gte(schema.conversations.tick, opts.sinceTick));
    }

    let query = this.db
      .select()
      .from(schema.conversations)
      .where(and(...conditions))
      .orderBy(desc(schema.conversations.timestamp));

    if (opts?.limit != null) {
      query = query.limit(opts.limit);
    }

    const rows = await query;
    return rows.map((row) => ({
      id: row.id,
      worldId: row.worldId,
      tick: row.tick,
      fromAgentId: row.fromAgentId,
      toAgentId: row.toAgentId,
      content: row.content,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      timestamp: row.timestamp,
    }));
  }

  // --- Consolidated knowledge ---

  async saveKnowledge(knowledge: ConsolidatedKnowledge): Promise<void> {
    await this.db.insert(schema.consolidatedKnowledge).values({
      id: knowledge.id,
      agentId: knowledge.agentId,
      worldId: knowledge.worldId,
      summary: knowledge.summary,
      sourceMemoryIds: knowledge.sourceMemoryIds,
      importance: knowledge.importance,
      category: knowledge.category ?? null,
      createdAt: knowledge.createdAt,
    });
  }

  async getKnowledge(
    agentId: string,
    worldId: string,
  ): Promise<ConsolidatedKnowledge[]> {
    const rows = await this.db
      .select()
      .from(schema.consolidatedKnowledge)
      .where(
        and(
          eq(schema.consolidatedKnowledge.agentId, agentId),
          eq(schema.consolidatedKnowledge.worldId, worldId),
        ),
      )
      .orderBy(desc(schema.consolidatedKnowledge.importance));

    return rows.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      worldId: row.worldId,
      summary: row.summary,
      sourceMemoryIds: row.sourceMemoryIds as string[],
      importance: row.importance,
      category: row.category ?? undefined,
      createdAt: row.createdAt,
    }));
  }

  async deleteKnowledge(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .delete(schema.consolidatedKnowledge)
      .where(inArray(schema.consolidatedKnowledge.id, ids));
  }

  // --- Lifecycle ---

  async createTables(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agent_configs (
        id TEXT NOT NULL,
        world_id TEXT NOT NULL,
        config JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id, world_id)
      );

      CREATE TABLE IF NOT EXISTS memory_entries (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        world_id TEXT NOT NULL,
        tick INTEGER NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata JSONB,
        importance REAL,
        timestamp TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_agent_world_ts
        ON memory_entries (agent_id, world_id, timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_memory_agent_importance
        ON memory_entries (agent_id, world_id, importance);

      CREATE TABLE IF NOT EXISTS state_snapshots (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        world_id TEXT NOT NULL,
        tick INTEGER NOT NULL,
        state JSONB NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_state_agent_world_tick
        ON state_snapshots (agent_id, world_id, tick DESC);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        tick INTEGER NOT NULL,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT,
        content TEXT NOT NULL,
        metadata JSONB,
        timestamp TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conv_world_tick
        ON conversations (world_id, tick);
      CREATE INDEX IF NOT EXISTS idx_conv_agent_ts
        ON conversations (from_agent_id, timestamp DESC);

      CREATE TABLE IF NOT EXISTS consolidated_knowledge (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        world_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        source_memory_ids JSONB NOT NULL,
        importance REAL NOT NULL,
        category TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_agent_world
        ON consolidated_knowledge (agent_id, world_id, importance DESC);

      CREATE TABLE IF NOT EXISTS relationships (
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        type TEXT NOT NULL,
        strength REAL NOT NULL,
        since INTEGER NOT NULL,
        last_interaction INTEGER,
        metadata JSONB,
        PRIMARY KEY (from_agent, to_agent, type)
      );
    `);
  }

  async dropTables(): Promise<void> {
    await this.pool.query(`
      DROP TABLE IF EXISTS relationships CASCADE;
      DROP TABLE IF EXISTS consolidated_knowledge CASCADE;
      DROP TABLE IF EXISTS conversations CASCADE;
      DROP TABLE IF EXISTS state_snapshots CASCADE;
      DROP TABLE IF EXISTS memory_entries CASCADE;
      DROP TABLE IF EXISTS agent_configs CASCADE;
    `);
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
  }
}
