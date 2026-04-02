import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryMemoryStore } from "../helpers/InMemoryMemoryStore.js";
import type { MemoryEntry } from "../../src/types/MemoryTypes.js";

function makeEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: `mem-${Math.random()}`,
    agentId: "agent-1",
    tick: 1,
    type: "action",
    content: "did something",
    timestamp: new Date(),
    ...overrides,
  };
}

describe("InMemoryMemoryStore", () => {
  let store: InMemoryMemoryStore;

  beforeEach(() => {
    store = new InMemoryMemoryStore();
  });

  it("saves and retrieves entries", async () => {
    const entry = makeEntry();
    await store.save(entry);
    const results = await store.getRecent("agent-1", 10);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("did something");
  });

  it("saveBatch stores multiple entries", async () => {
    await store.saveBatch([
      makeEntry({ id: "a" }),
      makeEntry({ id: "b" }),
      makeEntry({ id: "c" }),
    ]);
    const results = await store.getRecent("agent-1", 10);
    expect(results).toHaveLength(3);
  });

  it("filters by agentId", async () => {
    await store.save(makeEntry({ agentId: "agent-1" }));
    await store.save(makeEntry({ agentId: "agent-2" }));
    const results = await store.getRecent("agent-1", 10);
    expect(results).toHaveLength(1);
  });

  it("filters by type", async () => {
    await store.save(makeEntry({ type: "action" }));
    await store.save(makeEntry({ type: "observation" }));
    await store.save(makeEntry({ type: "reflection" }));
    const results = await store.query({
      agentId: "agent-1",
      types: ["action", "reflection"],
    });
    expect(results).toHaveLength(2);
  });

  it("filters by since tick", async () => {
    await store.save(makeEntry({ tick: 1 }));
    await store.save(makeEntry({ tick: 5 }));
    await store.save(makeEntry({ tick: 10 }));
    const results = await store.query({ agentId: "agent-1", since: 5 });
    expect(results).toHaveLength(2);
  });

  it("filters by search term", async () => {
    await store.save(makeEntry({ content: "talked to Alice" }));
    await store.save(makeEntry({ content: "observed Bob" }));
    const results = await store.query({
      agentId: "agent-1",
      search: "alice",
    });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("talked to Alice");
  });

  it("respects limit", async () => {
    await store.saveBatch([
      makeEntry({ id: "a" }),
      makeEntry({ id: "b" }),
      makeEntry({ id: "c" }),
    ]);
    const results = await store.getRecent("agent-1", 2);
    expect(results).toHaveLength(2);
  });

  it("returns results sorted by timestamp descending", async () => {
    await store.save(
      makeEntry({ id: "old", timestamp: new Date("2024-01-01") }),
    );
    await store.save(
      makeEntry({ id: "new", timestamp: new Date("2025-01-01") }),
    );
    const results = await store.getRecent("agent-1", 10);
    expect(results[0].id).toBe("new");
    expect(results[1].id).toBe("old");
  });

  it("clear removes only target agent entries", async () => {
    await store.save(makeEntry({ agentId: "agent-1" }));
    await store.save(makeEntry({ agentId: "agent-2" }));
    await store.clear("agent-1");
    expect(await store.getRecent("agent-1", 10)).toHaveLength(0);
    expect(await store.getRecent("agent-2", 10)).toHaveLength(1);
  });
});
