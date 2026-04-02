import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryPersistenceStore } from "../helpers/InMemoryPersistenceStore.js";
import type { MemoryEntry } from "../../src/types/MemoryTypes.js";
import type {
  ConsolidatedKnowledge,
  StateSnapshot,
  ConversationRecord,
  PersistedAgentConfig,
} from "../../src/types/PersistenceTypes.js";

describe("InMemoryPersistenceStore", () => {
  let store: InMemoryPersistenceStore;

  beforeEach(() => {
    store = new InMemoryPersistenceStore();
  });

  // --- Agent configs ---

  describe("agent configs", () => {
    const config: PersistedAgentConfig = {
      id: "agent-1",
      worldId: "world-1",
      config: {
        id: "agent-1",
        role: "person",
        name: "Alice",
      },
      createdAt: new Date("2025-01-01"),
      updatedAt: new Date("2025-01-01"),
    };

    it("saves and retrieves agent config", async () => {
      await store.saveAgentConfig(config);
      const result = await store.getAgentConfig("agent-1", "world-1");
      expect(result).toEqual(config);
    });

    it("returns null for non-existent config", async () => {
      const result = await store.getAgentConfig("nope", "world-1");
      expect(result).toBeNull();
    });

    it("lists configs by worldId", async () => {
      await store.saveAgentConfig(config);
      await store.saveAgentConfig({
        ...config,
        id: "agent-2",
        config: { ...config.config, id: "agent-2", name: "Bob" },
      });

      const list = await store.listAgentConfigs("world-1");
      expect(list).toHaveLength(2);
    });
  });

  // --- Memory entries ---

  describe("memory entries", () => {
    function makeEntry(
      id: string,
      agentId: string,
      tick: number,
      type: MemoryEntry["type"] = "action",
      timestamp = new Date(),
    ): MemoryEntry & { worldId: string } {
      return {
        id,
        agentId,
        tick,
        type,
        content: `content-${id}`,
        timestamp,
        worldId: "world-1",
      };
    }

    it("saves and retrieves entries", async () => {
      const entry = makeEntry("1", "agent-a", 1);
      await store.saveMemoryEntry(entry);

      const results = await store.getMemoryEntries("agent-a", "world-1");
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("1");
    });

    it("batch saves entries", async () => {
      await store.saveMemoryEntries([
        makeEntry("1", "agent-a", 1),
        makeEntry("2", "agent-a", 2),
      ]);

      const count = await store.countMemoryEntries("agent-a", "world-1");
      expect(count).toBe(2);
    });

    it("filters by type", async () => {
      await store.saveMemoryEntries([
        makeEntry("1", "agent-a", 1, "action"),
        makeEntry("2", "agent-a", 2, "reflection"),
      ]);

      const results = await store.getMemoryEntries("agent-a", "world-1", {
        types: ["reflection"],
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.type).toBe("reflection");
    });

    it("filters by date range", async () => {
      await store.saveMemoryEntries([
        makeEntry("1", "agent-a", 1, "action", new Date("2025-01-01")),
        makeEntry("2", "agent-a", 2, "action", new Date("2025-06-01")),
        makeEntry("3", "agent-a", 3, "action", new Date("2025-12-01")),
      ]);

      const results = await store.getMemoryEntries("agent-a", "world-1", {
        since: new Date("2025-03-01"),
        before: new Date("2025-09-01"),
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("2");
    });

    it("supports pagination", async () => {
      await store.saveMemoryEntries([
        makeEntry("1", "agent-a", 1, "action", new Date("2025-01-01")),
        makeEntry("2", "agent-a", 2, "action", new Date("2025-02-01")),
        makeEntry("3", "agent-a", 3, "action", new Date("2025-03-01")),
      ]);

      const page = await store.getMemoryEntries("agent-a", "world-1", {
        limit: 1,
        offset: 1,
      });
      expect(page).toHaveLength(1);
      expect(page[0]!.id).toBe("2"); // sorted desc, offset 1 = second
    });

    it("deletes entries", async () => {
      await store.saveMemoryEntries([
        makeEntry("1", "agent-a", 1),
        makeEntry("2", "agent-a", 2),
      ]);

      await store.deleteMemoryEntries(["1"]);
      const count = await store.countMemoryEntries("agent-a", "world-1");
      expect(count).toBe(1);
    });
  });

  // --- State snapshots ---

  describe("state snapshots", () => {
    const snapshot: StateSnapshot = {
      id: "snap-1",
      agentId: "agent-a",
      worldId: "world-1",
      tick: 5,
      state: {
        mood: "happy",
        energy: 80,
        goals: ["explore"],
        beliefs: {},
        knowledge: {},
        custom: {},
      },
      timestamp: new Date(),
    };

    it("saves and retrieves latest state", async () => {
      await store.saveStateSnapshot(snapshot);
      await store.saveStateSnapshot({
        ...snapshot,
        id: "snap-2",
        tick: 10,
        state: { ...snapshot.state, mood: "tired" },
      });

      const latest = await store.getLatestState("agent-a", "world-1");
      expect(latest?.tick).toBe(10);
      expect(latest?.state.mood).toBe("tired");
    });

    it("returns null when no snapshots exist", async () => {
      const result = await store.getLatestState("nope", "world-1");
      expect(result).toBeNull();
    });

    it("returns state history with limit", async () => {
      for (let i = 0; i < 5; i++) {
        await store.saveStateSnapshot({
          ...snapshot,
          id: `snap-${i}`,
          tick: i,
        });
      }

      const history = await store.getStateHistory("agent-a", "world-1", 3);
      expect(history).toHaveLength(3);
      expect(history[0]!.tick).toBe(4);
    });
  });

  // --- Conversations ---

  describe("conversations", () => {
    const record: ConversationRecord = {
      id: "conv-1",
      worldId: "world-1",
      tick: 3,
      fromAgentId: "agent-a",
      toAgentId: "agent-b",
      content: "Hello!",
      timestamp: new Date("2025-06-01"),
    };

    it("saves and retrieves conversations", async () => {
      await store.saveConversation(record);

      const results = await store.getConversations("world-1");
      expect(results).toHaveLength(1);
      expect(results[0]!.content).toBe("Hello!");
    });

    it("filters by agentId (from or to)", async () => {
      await store.saveConversation(record);
      await store.saveConversation({
        ...record,
        id: "conv-2",
        fromAgentId: "agent-c",
        toAgentId: "agent-d",
      });

      const results = await store.getConversations("world-1", {
        agentId: "agent-b",
      });
      expect(results).toHaveLength(1);
    });

    it("filters by sinceTick", async () => {
      await store.saveConversation({ ...record, id: "c1", tick: 1 });
      await store.saveConversation({ ...record, id: "c2", tick: 5 });

      const results = await store.getConversations("world-1", {
        sinceTick: 3,
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("c2");
    });
  });

  // --- Consolidated knowledge ---

  describe("consolidated knowledge", () => {
    const knowledge: ConsolidatedKnowledge = {
      id: "k-1",
      agentId: "agent-a",
      worldId: "world-1",
      summary: "Learned that cooperation leads to better outcomes",
      sourceMemoryIds: ["m-1", "m-2"],
      importance: 0.9,
      category: "belief",
      createdAt: new Date(),
    };

    it("saves and retrieves knowledge", async () => {
      await store.saveKnowledge(knowledge);
      const results = await store.getKnowledge("agent-a", "world-1");
      expect(results).toHaveLength(1);
      expect(results[0]!.summary).toContain("cooperation");
    });

    it("sorts by importance descending", async () => {
      await store.saveKnowledge(knowledge);
      await store.saveKnowledge({
        ...knowledge,
        id: "k-2",
        importance: 0.5,
        summary: "Less important",
      });

      const results = await store.getKnowledge("agent-a", "world-1");
      expect(results[0]!.importance).toBe(0.9);
      expect(results[1]!.importance).toBe(0.5);
    });

    it("deletes knowledge entries", async () => {
      await store.saveKnowledge(knowledge);
      await store.deleteKnowledge(["k-1"]);

      const results = await store.getKnowledge("agent-a", "world-1");
      expect(results).toHaveLength(0);
    });
  });
});
