import { describe, it, expect, beforeEach } from "vitest";
import { BrainMemory } from "../../src/memory/BrainMemory.js";
import { InMemoryMemoryStore } from "../helpers/InMemoryMemoryStore.js";
import { InMemoryVectorStore } from "../helpers/InMemoryVectorStore.js";
import { InMemoryPersistenceStore } from "../helpers/InMemoryPersistenceStore.js";
import { FakeEmbeddingAdapter } from "../helpers/FakeEmbeddingAdapter.js";
import type { MemoryEntry } from "../../src/types/MemoryTypes.js";

/**
 * End-to-end tests for the full BrainMemory lifecycle:
 * save → recall (recent + semantic) → consolidate → knowledge retrieval
 */
describe("BrainMemory e2e", () => {
  let memoryStore: InMemoryMemoryStore;
  let vectorStore: InMemoryVectorStore;
  let persistenceStore: InMemoryPersistenceStore;
  let embedder: FakeEmbeddingAdapter;
  let brain: BrainMemory;

  const WORLD_ID = "world-e2e";
  const AGENT_ID = "agent-alice";

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
    type: MemoryEntry["type"] = "action",
    daysAgo = 0,
    importance?: number,
  ): MemoryEntry {
    const timestamp = new Date();
    timestamp.setDate(timestamp.getDate() - daysAgo);
    return {
      id,
      agentId: AGENT_ID,
      tick: 1,
      type,
      content,
      timestamp,
      importance,
    };
  }

  it("full lifecycle: save, recall, consolidate, recall again", async () => {
    // 1. Save a series of memories over time
    const recentMemories = [
      makeEntry("r1", "I met Bob at the market today", "conversation", 1),
      makeEntry("r2", "The weather is sunny", "observation", 1),
      makeEntry("r3", "I need to buy groceries", "action", 0),
    ];

    const oldMemories = [
      makeEntry("o1", "Learned that cooperation builds trust", "reflection", 40, 0.9),
      makeEntry("o2", "Walked through the park", "action", 40),
      makeEntry("o3", "Had a deep conversation about philosophy with Carol", "conversation", 40, 0.8),
      makeEntry("o4", "Ate breakfast", "action", 40),
      makeEntry("o5", "Weather was cloudy", "observation", 40),
    ];

    for (const m of [...recentMemories, ...oldMemories]) {
      await brain.save(m, WORLD_ID);
    }

    // 2. Verify all stores have data
    expect(memoryStore.getAll()).toHaveLength(8);
    expect(vectorStore.getAll()).toHaveLength(8);
    expect(persistenceStore.getAllMemoryEntries()).toHaveLength(8);

    // 3. Recall should return recent memories
    const recallResult = await brain.recall({
      agentId: AGENT_ID,
      recentLimit: 20,
    });
    expect(recallResult.memories.length).toBe(8);

    // 4. Recall with semantic query should include vector results
    const semanticRecall = await brain.recall({
      agentId: AGENT_ID,
      recentLimit: 3,
      semanticQuery: "cooperation and trust",
      semanticTopK: 5,
    });
    // Should have recent + potentially some semantic matches
    expect(semanticRecall.memories.length).toBeGreaterThanOrEqual(3);

    // 5. Run consolidation (heuristic mode, no LLM needed)
    const consolidationResult = await brain.consolidate(AGENT_ID, WORLD_ID);

    expect(consolidationResult.agentId).toBe(AGENT_ID);
    expect(consolidationResult.processed).toBe(5); // 5 old entries
    expect(consolidationResult.promoted + consolidationResult.deleted).toBe(5);

    // 6. Check that knowledge was created from promoted entries
    const knowledge = await brain.getKnowledge(AGENT_ID, WORLD_ID);
    expect(knowledge.length).toBeGreaterThanOrEqual(1);

    // The reflection about cooperation (importance=0.9) should have been promoted
    const cooperationKnowledge = knowledge.find((k) =>
      k.summary.includes("cooperation"),
    );
    expect(cooperationKnowledge).toBeDefined();

    // 7. Recent entries should still exist
    const remainingEntries = await persistenceStore.getMemoryEntries(
      AGENT_ID,
      WORLD_ID,
    );
    const remainingIds = remainingEntries.map((e) => e.id);
    expect(remainingIds).toContain("r1");
    expect(remainingIds).toContain("r2");
    expect(remainingIds).toContain("r3");
  });

  it("state snapshot lifecycle", async () => {
    // Save state at different ticks
    await brain.snapshotState(AGENT_ID, WORLD_ID, 1, {
      mood: "neutral",
      energy: 100,
      goals: ["explore"],
      beliefs: {},
      knowledge: {},
      custom: {},
    });

    await brain.snapshotState(AGENT_ID, WORLD_ID, 5, {
      mood: "happy",
      energy: 80,
      goals: ["trade", "socialize"],
      beliefs: { trust: "important" },
      knowledge: { market_prices: "high" },
      custom: {},
    });

    // Restore latest state
    const state = await brain.restoreState(AGENT_ID, WORLD_ID);
    expect(state).not.toBeNull();
    expect(state!.mood).toBe("happy");
    expect(state!.energy).toBe(80);
    expect(state!.goals).toEqual(["trade", "socialize"]);
  });

  it("recallWithWorld includes knowledge context", async () => {
    // Save some knowledge
    await persistenceStore.saveKnowledge({
      id: "k1",
      agentId: AGENT_ID,
      worldId: WORLD_ID,
      summary: "Trust is built through repeated cooperation",
      sourceMemoryIds: ["m1", "m2"],
      importance: 0.9,
      category: "belief",
      createdAt: new Date(),
    });

    // Save a recent memory
    await brain.save(
      makeEntry("r1", "Just arrived at the market", "observation"),
      WORLD_ID,
    );

    const result = await brain.recallWithWorld({
      agentId: AGENT_ID,
      worldId: WORLD_ID,
      recentLimit: 10,
      includeKnowledge: true,
    });

    expect(result.memories.length).toBeGreaterThanOrEqual(1);
    expect(result.knowledge).toHaveLength(1);
    expect(result.knowledge[0]!.summary).toContain("Trust");
  });

  it("backward compatibility: works with only memoryStore", async () => {
    const minimalBrain = new BrainMemory({ memoryStore });

    const entry = makeEntry("1", "simple memory");
    await minimalBrain.save(entry, WORLD_ID);

    const result = await minimalBrain.recall({ agentId: AGENT_ID });
    expect(result.memories).toHaveLength(1);

    const knowledge = await minimalBrain.getKnowledge(AGENT_ID, WORLD_ID);
    expect(knowledge).toEqual([]);

    const consolidated = await minimalBrain.consolidate(AGENT_ID, WORLD_ID);
    expect(consolidated.processed).toBe(0);
    expect(consolidated.duration).toBe(0);

    const state = await minimalBrain.restoreState(AGENT_ID, WORLD_ID);
    expect(state).toBeNull();
  });

  it("multiple agents have isolated memories", async () => {
    const AGENT_B = "agent-bob";

    await brain.save(
      { ...makeEntry("a1", "Alice's memory"), agentId: AGENT_ID },
      WORLD_ID,
    );
    await brain.save(
      { ...makeEntry("b1", "Bob's memory"), agentId: AGENT_B },
      WORLD_ID,
    );

    const aliceRecall = await brain.recall({ agentId: AGENT_ID });
    const bobRecall = await brain.recall({ agentId: AGENT_B });

    expect(aliceRecall.memories).toHaveLength(1);
    expect(aliceRecall.memories[0]!.content).toBe("Alice's memory");

    expect(bobRecall.memories).toHaveLength(1);
    expect(bobRecall.memories[0]!.content).toBe("Bob's memory");
  });
});
