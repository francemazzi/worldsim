import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { RedisMemoryStore } from "./stores/RedisMemoryStore.js";
import type { MemoryEntry } from "../../src/types/MemoryTypes.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:16379";
let store: RedisMemoryStore;

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: `mem-${Math.random().toString(36).slice(2)}`,
    agentId: "agent-test",
    tick: 1,
    type: "action",
    content: "test action",
    timestamp: new Date(),
    ...overrides,
  };
}

describe.skipIf(!process.env.REDIS_URL && !process.env.CI)(
  "RedisMemoryStore integration",
  () => {
    beforeEach(async () => {
      store = new RedisMemoryStore(REDIS_URL);
      await store.clear("agent-test");
      await store.clear("agent-other");
    });

    afterAll(async () => {
      await store?.disconnect();
    });

    it("save and getRecent", async () => {
      await store.save(makeEntry({ content: "first" }));
      await store.save(
        makeEntry({
          content: "second",
          timestamp: new Date(Date.now() + 1000),
        }),
      );

      const results = await store.getRecent("agent-test", 10);
      expect(results).toHaveLength(2);
      expect(results[0].content).toBe("second");
    });

    it("saveBatch and query by type", async () => {
      await store.saveBatch([
        makeEntry({ type: "action", content: "acted" }),
        makeEntry({ type: "observation", content: "observed" }),
        makeEntry({ type: "reflection", content: "reflected" }),
      ]);

      const results = await store.query({
        agentId: "agent-test",
        types: ["action", "reflection"],
      });
      expect(results).toHaveLength(2);
    });

    it("query by since tick", async () => {
      await store.saveBatch([
        makeEntry({ tick: 1 }),
        makeEntry({ tick: 5 }),
        makeEntry({ tick: 10 }),
      ]);

      const results = await store.query({
        agentId: "agent-test",
        since: 5,
      });
      expect(results).toHaveLength(2);
    });

    it("query by search term", async () => {
      await store.saveBatch([
        makeEntry({ content: "talked to Alice about the project" }),
        makeEntry({ content: "observed Bob working" }),
      ]);

      const results = await store.query({
        agentId: "agent-test",
        search: "alice",
      });
      expect(results).toHaveLength(1);
      expect(results[0].content).toContain("Alice");
    });

    it("clear only removes target agent", async () => {
      await store.save(makeEntry({ agentId: "agent-test" }));
      await store.save(makeEntry({ agentId: "agent-other" }));

      await store.clear("agent-test");

      expect(await store.getRecent("agent-test", 10)).toHaveLength(0);
      expect(await store.getRecent("agent-other", 10)).toHaveLength(1);
    });

    it("persistence across ticks", async () => {
      await store.save(makeEntry({ tick: 1, content: "tick 1 action" }));
      await store.save(
        makeEntry({
          tick: 5,
          content: "tick 5 action",
          timestamp: new Date(Date.now() + 5000),
        }),
      );

      const results = await store.getRecent("agent-test", 10);
      expect(results).toHaveLength(2);
      expect(results.some((e) => e.content === "tick 1 action")).toBe(true);
    });
  },
);
