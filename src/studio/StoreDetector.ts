import type { MemoryStore } from "../types/MemoryTypes.js";
import type { GraphStore } from "../types/GraphTypes.js";
import type { VectorStore, EmbeddingAdapter } from "../types/VectorTypes.js";
import type { PersistenceStore } from "../types/PersistenceTypes.js";

export interface StoreCapability {
  connected: boolean;
  description: string;
  enables: string[];
  guide: string;
}

export interface StudioCapabilities {
  live: boolean;
  stores: {
    memory: StoreCapability;
    graph: StoreCapability;
    vector: StoreCapability;
    persistence: StoreCapability;
  };
}

export interface StoreRefs {
  memoryStore?: MemoryStore | undefined;
  graphStore?: GraphStore | undefined;
  vectorStore?: VectorStore | undefined;
  embeddingAdapter?: EmbeddingAdapter | undefined;
  persistenceStore?: PersistenceStore | undefined;
}

export function detectCapabilities(
  stores: StoreRefs,
  live: boolean,
): StudioCapabilities {
  return {
    live,
    stores: {
      memory: {
        connected: !!stores.memoryStore,
        description: "Agent memory storage (experiences, observations, reflections)",
        enables: ["Agent memory timeline", "Memory type filtering", "Memory search"],
        guide: [
          "// Add a MemoryStore to your WorldConfig:",
          "import { RedisMemoryStore } from './your-memory-store';",
          "",
          "const config: WorldConfig = {",
          "  memoryStore: new RedisMemoryStore('redis://localhost:6379'),",
          "  // ... rest of config",
          "};",
          "",
          "// Reference: tests/integration/stores/RedisMemoryStore.ts",
        ].join("\n"),
      },
      graph: {
        connected: !!stores.graphStore,
        description: "Agent relationship graph (social connections, interactions)",
        enables: ["Relationship graph visualization", "Agent connections", "Relationship strength/decay"],
        guide: [
          "// Add a GraphStore to your WorldConfig:",
          "import { Neo4jGraphStore } from './your-graph-store';",
          "",
          "const config: WorldConfig = {",
          "  graphStore: new Neo4jGraphStore('bolt://localhost:7687', 'neo4j', 'password'),",
          "  // ... rest of config",
          "};",
          "",
          "// Reference: tests/integration/stores/Neo4jGraphStore.ts",
        ].join("\n"),
      },
      vector: {
        connected: !!(stores.vectorStore && stores.embeddingAdapter),
        description: "Semantic vector search (similarity-based memory retrieval)",
        enables: ["Semantic search across agent memories", "Similar memory discovery"],
        guide: [
          "// Add a VectorStore + EmbeddingAdapter to your WorldConfig:",
          "import { PgVectorStore } from './your-vector-store';",
          "import { OpenAIEmbeddingAdapter } from './your-embedding-adapter';",
          "",
          "const config: WorldConfig = {",
          "  vectorStore: new PgVectorStore({ connectionString: '...', dimensions: 1536 }),",
          "  embeddingAdapter: new OpenAIEmbeddingAdapter({ apiKey: '...' }),",
          "  // ... rest of config",
          "};",
          "",
          "// Reference: tests/integration/stores/PgVectorStore.ts",
        ].join("\n"),
      },
      persistence: {
        connected: !!stores.persistenceStore,
        description: "Full persistence (conversations, state snapshots, consolidated knowledge)",
        enables: ["Conversation history", "Agent state snapshots", "Consolidated knowledge view"],
        guide: [
          "// Add a PersistenceStore to your WorldConfig:",
          "import { PgPersistenceStore } from './your-persistence-store';",
          "",
          "const config: WorldConfig = {",
          "  persistenceStore: new PgPersistenceStore({ connectionString: '...' }),",
          "  // ... rest of config",
          "};",
          "",
          "// Reference: tests/integration/stores/PgPersistenceStore.ts",
        ].join("\n"),
      },
    },
  };
}
