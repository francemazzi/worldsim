# Persistence & Databases

`worldsim` ships with a layered storage architecture. By default everything runs in-memory with zero external dependencies. When you need durability, swap in production store implementations backed by Redis, Neo4j, or PostgreSQL.

---

## Zero-config mode

If you pass no store options to `WorldConfig`, the engine runs entirely in-process memory. Agents still accumulate memories and relationships within a single run, but nothing survives a process restart. This is ideal for development, testing, and short-lived simulations.

---

## Store interfaces

All stores are defined as TypeScript interfaces. You can implement your own or use the built-in ones.

### MemoryStore

Defined in [`../src/types/MemoryTypes.ts`](../src/types/MemoryTypes.ts). Stores agent memory entries (actions, observations, conversations, reflections, knowledge).

```ts
interface MemoryStore {
  save(entry: MemoryEntry): Promise<void>;
  saveBatch(entries: MemoryEntry[]): Promise<void>;
  query(query: MemoryQuery): Promise<MemoryEntry[]>;
  getRecent(agentId: string, limit: number): Promise<MemoryEntry[]>;
  clear(agentId: string): Promise<void>;
}
```

### GraphStore

Defined in [`../src/types/GraphTypes.ts`](../src/types/GraphTypes.ts). Stores agent-to-agent relationships (friendship, rivalry, trust, etc.) with strength, decay, and metadata.

```ts
interface GraphStore {
  addRelationship(rel: Relationship): Promise<void>;
  updateRelationship(from, to, type, updates): Promise<void>;
  getRelationships(query: GraphQuery): Promise<Relationship[]>;
  getRelationship(from, to, type): Promise<Relationship | null>;
  removeRelationship(from, to, type): Promise<void>;
  getConnectedAgents(agentId: string): Promise<string[]>;
  // Optional batch methods for performance:
  upsertRelationshipBatch?(upserts: RelationshipUpsert[]): Promise<void>;
  removeRelationshipBatch?(entries: Array<{ from; to; type }>): Promise<void>;
}
```

### VectorStore

Defined in [`../src/types/VectorTypes.ts`](../src/types/VectorTypes.ts). Stores embedding vectors for semantic memory search.

```ts
interface VectorStore {
  upsert(entry: VectorEntry): Promise<void>;
  upsertBatch(entries: VectorEntry[]): Promise<void>;
  search(query: VectorQuery): Promise<VectorSearchResult[]>;
  delete(agentId: string, ids: string[]): Promise<void>;
  clear(agentId: string): Promise<void>;
}
```

Requires an `EmbeddingAdapter` to generate vectors:

```ts
interface EmbeddingAdapter {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}
```

### PersistenceStore

Defined in [`../src/types/PersistenceTypes.ts`](../src/types/PersistenceTypes.ts). Durable storage for agent configs, memory entries, state snapshots, conversation records, and consolidated knowledge. This is the most comprehensive interface and is used by `BrainMemory` for long-term persistence and `MemoryConsolidator` for memory promotion.

```ts
interface PersistenceStore {
  // Agent config CRUD
  saveAgentConfig(config: PersistedAgentConfig): Promise<void>;
  getAgentConfig(agentId, worldId): Promise<PersistedAgentConfig | null>;
  listAgentConfigs(worldId): Promise<PersistedAgentConfig[]>;

  // Memory entries
  saveMemoryEntry(entry: MemoryEntry & { worldId }): Promise<void>;
  saveMemoryEntries(entries): Promise<void>;
  getMemoryEntries(agentId, worldId, opts?): Promise<MemoryEntry[]>;
  deleteMemoryEntries(ids): Promise<void>;
  countMemoryEntries(agentId, worldId): Promise<number>;

  // State snapshots
  saveStateSnapshot(snapshot: StateSnapshot): Promise<void>;
  getLatestState(agentId, worldId): Promise<StateSnapshot | null>;
  getStateHistory(agentId, worldId, limit?): Promise<StateSnapshot[]>;

  // Conversations
  saveConversation(record: ConversationRecord): Promise<void>;
  getConversations(worldId, opts?): Promise<ConversationRecord[]>;

  // Consolidated knowledge
  saveKnowledge(knowledge: ConsolidatedKnowledge): Promise<void>;
  getKnowledge(agentId, worldId): Promise<ConsolidatedKnowledge[]>;
  deleteKnowledge(ids): Promise<void>;
}
```

---

## Built-in store implementations

### In-memory (zero dependencies)

| Class | Implements | Source |
|-------|-----------|--------|
| `InMemoryMemoryStore` | `MemoryStore` | [`../src/stores/InMemoryMemoryStore.ts`](../src/stores/InMemoryMemoryStore.ts) |
| `InMemoryGraphStore` | `GraphStore` | [`../src/stores/InMemoryGraphStore.ts`](../src/stores/InMemoryGraphStore.ts) |

These are plain JavaScript `Map`/`Array` backed stores. Data lives only in the process and is lost on restart. They are automatically used when no external store is configured.

### Production stores

| Class | Implements | Backing | Peer dependency |
|-------|-----------|---------|-----------------|
| `RedisMemoryStore` | `MemoryStore` | Redis 7+ | `ioredis` |
| `Neo4jGraphStore` | `GraphStore` | Neo4j 5+ | `neo4j-driver` |
| `PgVectorStore` | `VectorStore` | PostgreSQL 17 + pgvector | `drizzle-orm`, `@neondatabase/serverless` or `pg` |
| `PgPersistenceStore` | `PersistenceStore` | PostgreSQL 17 | `drizzle-orm` |
| `OpenAIEmbeddingAdapter` | `EmbeddingAdapter` | OpenAI API | `openai` |

All production stores are exported from [`../src/stores/index.ts`](../src/stores/index.ts).

---

## Configuring stores

Pass store instances to `WorldConfig` when creating the engine:

```ts
import { WorldEngine } from "worldsim";
import { RedisMemoryStore } from "worldsim/stores";
import { Neo4jGraphStore } from "worldsim/stores";
import { PgVectorStore } from "worldsim/stores";
import { PgPersistenceStore } from "worldsim/stores";
import { OpenAIEmbeddingAdapter } from "worldsim/stores";

const engine = new WorldEngine({
  llm: { baseURL: "...", apiKey: "...", model: "gpt-4o" },

  // Ephemeral memory (cross-tick, in-process)
  memoryStore: new RedisMemoryStore({ url: "redis://localhost:6379" }),

  // Relationship graph
  graphStore: new Neo4jGraphStore({
    uri: "bolt://localhost:7687",
    user: "neo4j",
    password: "password",
  }),

  // Semantic search
  vectorStore: new PgVectorStore({ connectionString: "postgres://..." }),
  embeddingAdapter: new OpenAIEmbeddingAdapter({
    apiKey: "sk-...",
    model: "text-embedding-3-small",
  }),

  // Durable persistence (state snapshots, conversation history, knowledge)
  persistenceStore: new PgPersistenceStore({ connectionString: "postgres://..." }),

  // Memory consolidation settings
  consolidation: {
    retentionDays: 30,
    importanceThreshold: 0.6,
    generateSummaries: true,
  },
});
```

When `memoryStore` is provided alongside `vectorStore` or `persistenceStore`, the engine automatically composes a `BrainMemory` instance that coordinates writes across all layers.

---

## Docker test environment

A `docker-compose.test.yml` is provided at the project root for spinning up all three backing databases locally:

```bash
docker compose -f docker-compose.test.yml up -d
```

This starts:

| Service | Image | Port |
|---------|-------|------|
| Redis | `redis:7-alpine` | `16379` |
| Neo4j | `neo4j:5-community` | `7687` (bolt), `7474` (browser) |
| PostgreSQL + pgvector | `pgvector/pgvector:pg17` | `5432` |

Default credentials for the test environment:
- Neo4j: `neo4j` / `testpassword`
- PostgreSQL: `postgres` / `testpassword`, database `worldsim_test`

Source: [`../docker-compose.test.yml`](../docker-compose.test.yml)

---

## Implementing a custom store

To implement a custom store, create a class that satisfies the relevant interface. For example, a MongoDB-backed `MemoryStore`:

```ts
import type { MemoryStore, MemoryEntry, MemoryQuery } from "worldsim";

export class MongoMemoryStore implements MemoryStore {
  private collection: Collection<MemoryEntry>;

  constructor(collection: Collection<MemoryEntry>) {
    this.collection = collection;
  }

  async save(entry: MemoryEntry): Promise<void> {
    await this.collection.insertOne(entry);
  }

  async saveBatch(entries: MemoryEntry[]): Promise<void> {
    if (entries.length > 0) {
      await this.collection.insertMany(entries);
    }
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const filter: Record<string, unknown> = { agentId: query.agentId };
    if (query.types?.length) filter.type = { $in: query.types };
    if (query.since != null) filter.tick = { $gte: query.since };

    return this.collection
      .find(filter)
      .sort({ timestamp: -1 })
      .limit(query.limit ?? 100)
      .toArray();
  }

  async getRecent(agentId: string, limit: number): Promise<MemoryEntry[]> {
    return this.query({ agentId, limit });
  }

  async clear(agentId: string): Promise<void> {
    await this.collection.deleteMany({ agentId });
  }
}
```

Then pass it to the engine:

```ts
const engine = new WorldEngine({
  llm: { ... },
  memoryStore: new MongoMemoryStore(db.collection("memories")),
});
```

The same pattern applies to `GraphStore`, `VectorStore`, and `PersistenceStore`. Implement the interface, instantiate your class, and pass it in the config.
