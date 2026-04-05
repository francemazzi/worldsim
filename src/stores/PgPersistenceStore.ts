import { drizzle } from "drizzle-orm/node-postgres";
import { eq, and, gte, lt, inArray, desc, sql } from "drizzle-orm";
import pg from "pg";
import type {
  PersistenceStore,
  PersistedAgentConfig,
  StateSnapshot,
  ConversationRecord,
  ConsolidatedKnowledge,
  PrivacyConsentRecord,
  PrivacyPolicyAuditRecord,
  AgentStorageUsage,
} from "../types/PersistenceTypes.js";
import type { MemoryEntry } from "../types/MemoryTypes.js";
import type { AgentInternalState } from "../types/AgentTypes.js";
import type { PrivacyConsentStatus, PrivacyDataCategory } from "../types/PrivacyTypes.js";
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

    const baseQuery = this.db
      .select()
      .from(schema.memoryEntries)
      .where(and(...conditions))
      .orderBy(desc(schema.memoryEntries.timestamp));

    const rows = opts?.limit != null
      ? await baseQuery.offset(opts?.offset ?? 0).limit(opts.limit)
      : await baseQuery;
    return rows.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      tick: row.tick,
      type: row.type as MemoryEntry["type"],
      content: row.content,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      importance: row.importance ?? undefined,
      timestamp: row.timestamp,
    }) as MemoryEntry);
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

    const rows = limit != null ? await query.limit(limit) : await query;
    return rows.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      worldId: row.worldId,
      tick: row.tick,
      state: row.state as AgentInternalState,
      timestamp: row.timestamp,
    }) as StateSnapshot);
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

    const baseQuery = this.db
      .select()
      .from(schema.conversations)
      .where(and(...conditions))
      .orderBy(desc(schema.conversations.timestamp));

    const rows = opts?.limit != null
      ? await baseQuery.limit(opts.limit)
      : await baseQuery;
    return rows.map((row) => ({
      id: row.id,
      worldId: row.worldId,
      tick: row.tick,
      fromAgentId: row.fromAgentId,
      toAgentId: row.toAgentId,
      content: row.content,
      metadata: (row.metadata as Record<string, unknown>) ?? undefined,
      timestamp: row.timestamp,
    }) as ConversationRecord);
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
    }) as ConsolidatedKnowledge);
  }

  async deleteKnowledge(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .delete(schema.consolidatedKnowledge)
      .where(inArray(schema.consolidatedKnowledge.id, ids));
  }

  // --- Privacy consent & policy audit ---

  async upsertConsent(record: PrivacyConsentRecord): Promise<void> {
    await this.db
      .insert(schema.privacyConsents)
      .values({
        id: record.id,
        worldId: record.worldId,
        subjectId: record.subjectId,
        category: record.category,
        regulatoryProfile: record.regulatoryProfile,
        policyVersion: record.policyVersion,
        status: record.status,
        source: record.source ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      })
      .onConflictDoUpdate({
        target: [schema.privacyConsents.id],
        set: {
          worldId: record.worldId,
          subjectId: record.subjectId,
          category: record.category,
          regulatoryProfile: record.regulatoryProfile,
          policyVersion: record.policyVersion,
          status: record.status,
          source: record.source ?? null,
          updatedAt: record.updatedAt,
        },
      });
  }

  async getConsent(
    worldId: string,
    subjectId: string,
    category: PrivacyDataCategory,
  ): Promise<PrivacyConsentRecord | null> {
    const rows = await this.db
      .select()
      .from(schema.privacyConsents)
      .where(
        and(
          eq(schema.privacyConsents.worldId, worldId),
          eq(schema.privacyConsents.subjectId, subjectId),
          eq(schema.privacyConsents.category, category),
        ),
      )
      .orderBy(desc(schema.privacyConsents.updatedAt))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      worldId: row.worldId,
      subjectId: row.subjectId,
      category: row.category as PrivacyDataCategory,
      regulatoryProfile: row.regulatoryProfile,
      policyVersion: row.policyVersion,
      status: row.status as PrivacyConsentStatus,
      source: row.source ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async listConsents(
    worldId: string,
    opts?: {
      subjectId?: string;
      category?: PrivacyDataCategory;
      status?: PrivacyConsentStatus;
      limit?: number;
    },
  ): Promise<PrivacyConsentRecord[]> {
    const conditions = [eq(schema.privacyConsents.worldId, worldId)];
    if (opts?.subjectId) {
      conditions.push(eq(schema.privacyConsents.subjectId, opts.subjectId));
    }
    if (opts?.category) {
      conditions.push(eq(schema.privacyConsents.category, opts.category));
    }
    if (opts?.status) {
      conditions.push(eq(schema.privacyConsents.status, opts.status));
    }

    const base = this.db
      .select()
      .from(schema.privacyConsents)
      .where(and(...conditions))
      .orderBy(desc(schema.privacyConsents.updatedAt));
    const rows = opts?.limit != null ? await base.limit(opts.limit) : await base;
    return rows.map((row) => ({
      id: row.id,
      worldId: row.worldId,
      subjectId: row.subjectId,
      category: row.category as PrivacyDataCategory,
      regulatoryProfile: row.regulatoryProfile,
      policyVersion: row.policyVersion,
      status: row.status as PrivacyConsentStatus,
      source: row.source ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async savePolicyAudit(record: PrivacyPolicyAuditRecord): Promise<void> {
    await this.db.insert(schema.privacyPolicyAudits).values({
      id: record.id,
      worldId: record.worldId,
      agentId: record.agentId,
      category: record.category,
      decision: record.decision,
      reasonCode: record.reasonCode,
      tick: record.tick,
      policyVersion: record.policyVersion ?? null,
      details: record.details ?? null,
      timestamp: record.timestamp,
    });
  }

  async listPolicyAudits(
    worldId: string,
    opts?: {
      agentId?: string;
      category?: PrivacyDataCategory;
      decision?: "allow" | "reduce" | "deny";
      limit?: number;
    },
  ): Promise<PrivacyPolicyAuditRecord[]> {
    const conditions = [eq(schema.privacyPolicyAudits.worldId, worldId)];
    if (opts?.agentId) {
      conditions.push(eq(schema.privacyPolicyAudits.agentId, opts.agentId));
    }
    if (opts?.category) {
      conditions.push(eq(schema.privacyPolicyAudits.category, opts.category));
    }
    if (opts?.decision) {
      conditions.push(eq(schema.privacyPolicyAudits.decision, opts.decision));
    }
    const base = this.db
      .select()
      .from(schema.privacyPolicyAudits)
      .where(and(...conditions))
      .orderBy(desc(schema.privacyPolicyAudits.timestamp));
    const rows = opts?.limit != null ? await base.limit(opts.limit) : await base;
    return rows.map((row) => ({
      id: row.id,
      worldId: row.worldId,
      agentId: row.agentId,
      category: row.category as PrivacyDataCategory,
      decision: row.decision as "allow" | "reduce" | "deny",
      reasonCode: row.reasonCode,
      tick: row.tick,
      policyVersion: row.policyVersion ?? undefined,
      details: (row.details as Record<string, unknown>) ?? undefined,
      timestamp: row.timestamp,
    }));
  }

  async estimateAgentStorageUsage(
    agentId: string,
    worldId: string,
  ): Promise<AgentStorageUsage> {
    const [memoryCount, snapshotCount, conversationCount, knowledgeCount, bytesResult] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.memoryEntries)
        .where(and(eq(schema.memoryEntries.agentId, agentId), eq(schema.memoryEntries.worldId, worldId))),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.stateSnapshots)
        .where(and(eq(schema.stateSnapshots.agentId, agentId), eq(schema.stateSnapshots.worldId, worldId))),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.conversations)
        .where(and(
          eq(schema.conversations.worldId, worldId),
          sql`(${schema.conversations.fromAgentId} = ${agentId} OR ${schema.conversations.toAgentId} = ${agentId})`,
        )),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.consolidatedKnowledge)
        .where(and(eq(schema.consolidatedKnowledge.agentId, agentId), eq(schema.consolidatedKnowledge.worldId, worldId))),
      this.pool.query(
        `
          select (
            coalesce((select sum(length(content)) from memory_entries where agent_id = $1 and world_id = $2), 0) +
            coalesce((select sum(length(content)) from conversations where world_id = $2 and (from_agent_id = $1 or to_agent_id = $1)), 0) +
            coalesce((select sum(length(summary)) from consolidated_knowledge where agent_id = $1 and world_id = $2), 0)
          )::int as approx
        `,
        [agentId, worldId],
      ),
    ]);

    return {
      worldId,
      agentId,
      memoryEntries: memoryCount[0]?.count ?? 0,
      stateSnapshots: snapshotCount[0]?.count ?? 0,
      conversations: conversationCount[0]?.count ?? 0,
      consolidatedKnowledge: knowledgeCount[0]?.count ?? 0,
      estimatedBytes: Number((bytesResult.rows[0] as { approx?: number } | undefined)?.approx ?? 0),
    };
  }

  async deleteAgentData(
    agentId: string,
    worldId: string,
  ): Promise<{
    memoryEntries: number;
    stateSnapshots: number;
    conversations: number;
    consolidatedKnowledge: number;
    policyAudits: number;
    consents: number;
  }> {
    const memoryEntries = await this.db
      .delete(schema.memoryEntries)
      .where(and(eq(schema.memoryEntries.agentId, agentId), eq(schema.memoryEntries.worldId, worldId)))
      .returning({ id: schema.memoryEntries.id });
    const stateSnapshots = await this.db
      .delete(schema.stateSnapshots)
      .where(and(eq(schema.stateSnapshots.agentId, agentId), eq(schema.stateSnapshots.worldId, worldId)))
      .returning({ id: schema.stateSnapshots.id });
    const conversations = await this.db
      .delete(schema.conversations)
      .where(and(
        eq(schema.conversations.worldId, worldId),
        sql`(${schema.conversations.fromAgentId} = ${agentId} OR ${schema.conversations.toAgentId} = ${agentId})`,
      ))
      .returning({ id: schema.conversations.id });
    const consolidatedKnowledge = await this.db
      .delete(schema.consolidatedKnowledge)
      .where(and(eq(schema.consolidatedKnowledge.agentId, agentId), eq(schema.consolidatedKnowledge.worldId, worldId)))
      .returning({ id: schema.consolidatedKnowledge.id });
    const policyAudits = await this.db
      .delete(schema.privacyPolicyAudits)
      .where(and(eq(schema.privacyPolicyAudits.agentId, agentId), eq(schema.privacyPolicyAudits.worldId, worldId)))
      .returning({ id: schema.privacyPolicyAudits.id });
    const consents = await this.db
      .delete(schema.privacyConsents)
      .where(and(eq(schema.privacyConsents.subjectId, agentId), eq(schema.privacyConsents.worldId, worldId)))
      .returning({ id: schema.privacyConsents.id });

    return {
      memoryEntries: memoryEntries.length,
      stateSnapshots: stateSnapshots.length,
      conversations: conversations.length,
      consolidatedKnowledge: consolidatedKnowledge.length,
      policyAudits: policyAudits.length,
      consents: consents.length,
    };
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
        world_id TEXT NOT NULL DEFAULT 'legacy-default',
        from_agent TEXT NOT NULL,
        to_agent TEXT NOT NULL,
        type TEXT NOT NULL,
        strength REAL NOT NULL,
        since INTEGER NOT NULL,
        last_interaction INTEGER,
        metadata JSONB,
        PRIMARY KEY (world_id, from_agent, to_agent, type)
      );
      CREATE INDEX IF NOT EXISTS idx_relationships_world
        ON relationships (world_id, from_agent, to_agent);

      CREATE TABLE IF NOT EXISTS privacy_consents (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        category TEXT NOT NULL,
        regulatory_profile TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        status TEXT NOT NULL,
        source TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_privacy_consents_world_subject
        ON privacy_consents (world_id, subject_id);
      CREATE INDEX IF NOT EXISTS idx_privacy_consents_lookup
        ON privacy_consents (world_id, subject_id, category, status);

      CREATE TABLE IF NOT EXISTS privacy_policy_audits (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        category TEXT NOT NULL,
        decision TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        tick INTEGER NOT NULL,
        policy_version TEXT,
        details JSONB,
        timestamp TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_privacy_audits_world_tick
        ON privacy_policy_audits (world_id, tick);
      CREATE INDEX IF NOT EXISTS idx_privacy_audits_agent
        ON privacy_policy_audits (world_id, agent_id, timestamp DESC);
    `);
  }

  async dropTables(): Promise<void> {
    await this.pool.query(`
      DROP TABLE IF EXISTS privacy_policy_audits CASCADE;
      DROP TABLE IF EXISTS privacy_consents CASCADE;
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
