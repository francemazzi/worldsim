import {
  pgTable,
  text,
  timestamp,
  integer,
  real,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const agentConfigs = pgTable(
  "agent_configs",
  {
    id: text("id").notNull(),
    worldId: text("world_id").notNull(),
    config: jsonb("config").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.worldId] }),
  ],
);

export const memoryEntries = pgTable(
  "memory_entries",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    worldId: text("world_id").notNull(),
    tick: integer("tick").notNull(),
    type: text("type").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata"),
    importance: real("importance"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_memory_agent_world_ts").on(
      table.agentId,
      table.worldId,
      table.timestamp,
    ),
    index("idx_memory_agent_importance").on(
      table.agentId,
      table.worldId,
      table.importance,
    ),
  ],
);

export const stateSnapshots = pgTable(
  "state_snapshots",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    worldId: text("world_id").notNull(),
    tick: integer("tick").notNull(),
    state: jsonb("state").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_state_agent_world_tick").on(
      table.agentId,
      table.worldId,
      table.tick,
    ),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    worldId: text("world_id").notNull(),
    tick: integer("tick").notNull(),
    fromAgentId: text("from_agent_id").notNull(),
    toAgentId: text("to_agent_id"),
    content: text("content").notNull(),
    metadata: jsonb("metadata"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_conv_world_tick").on(table.worldId, table.tick),
    index("idx_conv_agent_ts").on(table.fromAgentId, table.timestamp),
  ],
);

export const consolidatedKnowledge = pgTable(
  "consolidated_knowledge",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull(),
    worldId: text("world_id").notNull(),
    summary: text("summary").notNull(),
    sourceMemoryIds: jsonb("source_memory_ids").notNull(),
    importance: real("importance").notNull(),
    category: text("category"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_knowledge_agent_world").on(
      table.agentId,
      table.worldId,
      table.importance,
    ),
  ],
);

export const relationships = pgTable(
  "relationships",
  {
    fromAgent: text("from_agent").notNull(),
    toAgent: text("to_agent").notNull(),
    type: text("type").notNull(),
    strength: real("strength").notNull(),
    since: integer("since").notNull(),
    lastInteraction: integer("last_interaction"),
    metadata: jsonb("metadata"),
  },
  (table) => [
    primaryKey({ columns: [table.fromAgent, table.toAgent, table.type] }),
  ],
);
