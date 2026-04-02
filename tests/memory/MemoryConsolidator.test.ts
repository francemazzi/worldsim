import { describe, it, expect, beforeEach } from "vitest";
import { MemoryConsolidator } from "../../src/memory/MemoryConsolidator.js";
import { InMemoryMemoryStore } from "../helpers/InMemoryMemoryStore.js";
import { InMemoryPersistenceStore } from "../helpers/InMemoryPersistenceStore.js";
import { InMemoryVectorStore } from "../helpers/InMemoryVectorStore.js";
import type { MemoryEntry } from "../../src/types/MemoryTypes.js";

describe("MemoryConsolidator", () => {
  let memoryStore: InMemoryMemoryStore;
  let persistenceStore: InMemoryPersistenceStore;
  let vectorStore: InMemoryVectorStore;
  let consolidator: MemoryConsolidator;

  beforeEach(() => {
    memoryStore = new InMemoryMemoryStore();
    persistenceStore = new InMemoryPersistenceStore();
    vectorStore = new InMemoryVectorStore();
  });

  function makeOldEntry(
    id: string,
    type: MemoryEntry["type"] = "action",
    daysAgo = 40,
    content = "some content",
  ): MemoryEntry & { worldId: string } {
    const timestamp = new Date();
    timestamp.setDate(timestamp.getDate() - daysAgo);
    return {
      id,
      agentId: "agent-a",
      tick: 1,
      type,
      content,
      timestamp,
      worldId: "world-1",
    };
  }

  describe("heuristic scoring", () => {
    it("scores knowledge entries highest", async () => {
      consolidator = new MemoryConsolidator({
        memoryStore,
        persistenceStore,
        config: { scoringStrategy: "heuristic", retentionDays: 30, importanceThreshold: 0.6, batchSize: 100, generateSummaries: false },
      });

      const knowledgeEntry: MemoryEntry = {
        id: "k1",
        agentId: "agent-a",
        tick: 1,
        type: "knowledge",
        content: "Important fact with lots of detail and context about the world and its inhabitants",
        metadata: { source: "observation" },
        timestamp: new Date(),
        importance: 0.9,
      };

      const actionEntry: MemoryEntry = {
        id: "a1",
        agentId: "agent-a",
        tick: 1,
        type: "action",
        content: "ok",
        timestamp: new Date(),
      };

      const scores = await consolidator.scoreImportance([
        knowledgeEntry,
        actionEntry,
      ]);

      const kScore = scores.find((s) => s.memoryId === "k1")!;
      const aScore = scores.find((s) => s.memoryId === "a1")!;

      expect(kScore.score).toBeGreaterThan(aScore.score);
    });
  });

  describe("consolidation process", () => {
    it("promotes important entries and deletes unimportant ones", async () => {
      consolidator = new MemoryConsolidator({
        memoryStore,
        persistenceStore,
        vectorStore,
        config: {
          scoringStrategy: "heuristic",
          retentionDays: 30,
          importanceThreshold: 0.5,
          batchSize: 100,
          generateSummaries: false,
        },
      });

      // Old reflection with high importance + metadata (should be promoted)
      await persistenceStore.saveMemoryEntry({
        ...makeOldEntry("r1", "reflection", 40, "Deep insight about cooperation and its long-term benefits for the community. This changes how I see the world entirely and affects all future decisions."),
        importance: 0.9,
        metadata: { significant: true },
      });

      // Old action with low importance (should be deleted)
      await persistenceStore.saveMemoryEntry(
        makeOldEntry("a1", "action", 40, "ok"),
      );

      // Recent entry (should be untouched — not old enough)
      await persistenceStore.saveMemoryEntry(
        makeOldEntry("recent", "action", 5, "recent action"),
      );

      const result = await consolidator.consolidate("agent-a", "world-1");

      expect(result.processed).toBe(2); // only old entries
      expect(result.promoted).toBeGreaterThanOrEqual(1);
      expect(result.deleted).toBeGreaterThanOrEqual(1);

      // Knowledge should have been created from promoted entries
      const knowledge = await persistenceStore.getKnowledge(
        "agent-a",
        "world-1",
      );
      expect(knowledge.length).toBeGreaterThanOrEqual(1);

      // Deleted entries should be removed from persistence
      const remaining = await persistenceStore.getMemoryEntries(
        "agent-a",
        "world-1",
      );
      // Only recent entry should remain (old deleted one is gone)
      const ids = remaining.map((e) => e.id);
      expect(ids).not.toContain("a1");
      expect(ids).toContain("recent");
    });

    it("returns zero counts when no old entries exist", async () => {
      consolidator = new MemoryConsolidator({
        memoryStore,
        persistenceStore,
        config: {
          scoringStrategy: "heuristic",
          retentionDays: 30,
          importanceThreshold: 0.6,
          batchSize: 100,
          generateSummaries: false,
        },
      });

      const result = await consolidator.consolidate("agent-a", "world-1");

      expect(result.processed).toBe(0);
      expect(result.promoted).toBe(0);
      expect(result.deleted).toBe(0);
    });

    it("deletes from vector store when consolidating", async () => {
      consolidator = new MemoryConsolidator({
        memoryStore,
        persistenceStore,
        vectorStore,
        config: {
          scoringStrategy: "heuristic",
          retentionDays: 30,
          importanceThreshold: 0.99, // very high — everything gets deleted
          batchSize: 100,
          generateSummaries: false,
        },
      });

      // Add vector entry
      await vectorStore.upsert({
        id: "a1",
        agentId: "agent-a",
        content: "test",
        embedding: [1, 0, 0, 0, 0, 0, 0, 0],
        timestamp: new Date(),
      });

      // Add old persistence entry
      await persistenceStore.saveMemoryEntry(
        makeOldEntry("a1", "action", 40, "test"),
      );

      await consolidator.consolidate("agent-a", "world-1");

      expect(vectorStore.getAll()).toHaveLength(0);
    });
  });
});
