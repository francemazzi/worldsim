import { describe, it, expect, beforeEach } from "vitest";
import { BrainMemory } from "../../src/memory/BrainMemory.js";
import { InMemoryMemoryStore } from "../helpers/InMemoryMemoryStore.js";
import { InMemoryVectorStore } from "../helpers/InMemoryVectorStore.js";
import { InMemoryPersistenceStore } from "../helpers/InMemoryPersistenceStore.js";
import { FakeEmbeddingAdapter } from "../helpers/FakeEmbeddingAdapter.js";
import type { MemoryEntry } from "../../src/types/MemoryTypes.js";

describe("BrainMemory", () => {
  let memoryStore: InMemoryMemoryStore;
  let vectorStore: InMemoryVectorStore;
  let persistenceStore: InMemoryPersistenceStore;
  let embedder: FakeEmbeddingAdapter;
  let brain: BrainMemory;

  beforeEach(() => {
    memoryStore = new InMemoryMemoryStore();
    vectorStore = new InMemoryVectorStore();
    persistenceStore = new InMemoryPersistenceStore();
    embedder = new FakeEmbeddingAdapter(8);
    brain = new BrainMemory({
      memoryStore,
      vectorStore,
      persistenceStore,
      embeddingAdapter: embedder,
    });
  });

  function makeEntry(
    id: string,
    content: string,
    agentId = "agent-a",
  ): MemoryEntry {
    return {
      id,
      agentId,
      tick: 1,
      type: "action",
      content,
      timestamp: new Date(),
    };
  }

  describe("save", () => {
    it("writes to all three stores simultaneously", async () => {
      const entry = makeEntry("1", "hello world");
      await brain.save(entry, "world-1");

      expect(memoryStore.getAll()).toHaveLength(1);
      expect(vectorStore.getAll()).toHaveLength(1);
      expect(persistenceStore.getAllMemoryEntries()).toHaveLength(1);
    });

    it("generates embedding for vector store", async () => {
      const entry = makeEntry("1", "test content");
      await brain.save(entry, "world-1");

      const vecEntries = vectorStore.getAll();
      expect(vecEntries[0]!.embedding).toHaveLength(8);
      expect(vecEntries[0]!.memoryEntryId).toBe("1");
    });

    it("works with only memoryStore (no vector/persistence)", async () => {
      const minimalBrain = new BrainMemory({ memoryStore });
      const entry = makeEntry("1", "minimal");
      await minimalBrain.save(entry, "world-1");

      expect(memoryStore.getAll()).toHaveLength(1);
      expect(vectorStore.getAll()).toHaveLength(0);
    });
  });

  describe("saveBatch", () => {
    it("batch writes to all stores", async () => {
      const entries = [
        makeEntry("1", "first"),
        makeEntry("2", "second"),
      ];
      await brain.saveBatch(entries, "world-1");

      expect(memoryStore.getAll()).toHaveLength(2);
      expect(vectorStore.getAll()).toHaveLength(2);
      expect(persistenceStore.getAllMemoryEntries()).toHaveLength(2);
    });
  });

  describe("recall", () => {
    it("returns recent memories from memoryStore", async () => {
      const entry = makeEntry("1", "recent memory");
      await memoryStore.save(entry);

      const result = await brain.recall({ agentId: "agent-a" });

      expect(result.memories).toHaveLength(1);
      expect(result.memories[0]!.content).toBe("recent memory");
    });

    it("includes semantic results when query is provided", async () => {
      // Save entry through brain to populate vector store
      const entry = makeEntry("1", "the weather is sunny today");
      await brain.save(entry, "world-1");

      // Clear the memory store to isolate semantic search results
      await memoryStore.clear("agent-a");

      const result = await brain.recall({
        agentId: "agent-a",
        semanticQuery: "the weather is sunny today",
        semanticTopK: 5,
      });

      // Should have the semantic result (exact match)
      expect(result.memories.length).toBeGreaterThanOrEqual(1);
    });

    it("deduplicates between recent and semantic results", async () => {
      const entry = makeEntry("1", "test content");
      await brain.save(entry, "world-1");

      const result = await brain.recall({
        agentId: "agent-a",
        recentLimit: 10,
        semanticQuery: "test content",
        semanticTopK: 10,
      });

      // Should have at most one entry for the same content
      const ids = result.memories.map((m) => m.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe("recallWithWorld", () => {
    it("includes consolidated knowledge when available", async () => {
      await persistenceStore.saveKnowledge({
        id: "k1",
        agentId: "agent-a",
        worldId: "world-1",
        summary: "Important learned fact",
        sourceMemoryIds: ["m1"],
        importance: 0.9,
        category: "belief",
        createdAt: new Date(),
      });

      const result = await brain.recallWithWorld({
        agentId: "agent-a",
        worldId: "world-1",
        includeKnowledge: true,
      });

      expect(result.knowledge).toHaveLength(1);
      expect(result.knowledge[0]!.summary).toContain("Important");
    });
  });

  describe("snapshotState / restoreState", () => {
    it("snapshots and restores agent state", async () => {
      const state = {
        mood: "happy",
        energy: 90,
        goals: ["explore"],
        beliefs: { world: "safe" },
        knowledge: {},
        custom: {},
      };

      await brain.snapshotState("agent-a", "world-1", 5, state);
      const restored = await brain.restoreState("agent-a", "world-1");

      expect(restored).toEqual(state);
    });

    it("returns null when no snapshot exists", async () => {
      const result = await brain.restoreState("agent-a", "world-1");
      expect(result).toBeNull();
    });
  });

  describe("consolidate", () => {
    it("delegates to consolidator and returns result", async () => {
      // No old entries, should return zero counts
      const result = await brain.consolidate("agent-a", "world-1");

      expect(result.agentId).toBe("agent-a");
      expect(result.processed).toBe(0);
    });

    it("returns empty result when no persistence store", async () => {
      const noPersistBrain = new BrainMemory({ memoryStore });
      const result = await noPersistBrain.consolidate("agent-a", "world-1");

      expect(result.processed).toBe(0);
      expect(result.duration).toBe(0);
    });
  });

  describe("getKnowledge", () => {
    it("returns consolidated knowledge", async () => {
      await persistenceStore.saveKnowledge({
        id: "k1",
        agentId: "agent-a",
        worldId: "world-1",
        summary: "cooperation is beneficial",
        sourceMemoryIds: ["m1"],
        importance: 0.8,
        createdAt: new Date(),
      });

      const knowledge = await brain.getKnowledge("agent-a", "world-1");
      expect(knowledge).toHaveLength(1);
    });

    it("returns empty when no persistence store", async () => {
      const noPersistBrain = new BrainMemory({ memoryStore });
      const knowledge = await noPersistBrain.getKnowledge("agent-a", "w");
      expect(knowledge).toEqual([]);
    });
  });
});
