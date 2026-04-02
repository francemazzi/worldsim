import { describe, it, expect, beforeEach } from "vitest";
import { EmbeddingManager } from "../../src/memory/EmbeddingManager.js";
import { FakeEmbeddingAdapter } from "../helpers/FakeEmbeddingAdapter.js";
import type { MemoryEntry } from "../../src/types/MemoryTypes.js";

describe("EmbeddingManager", () => {
  let manager: EmbeddingManager;
  let adapter: FakeEmbeddingAdapter;

  beforeEach(() => {
    adapter = new FakeEmbeddingAdapter(8);
    manager = new EmbeddingManager(adapter);
  });

  function makeEntry(id: string, content: string): MemoryEntry {
    return {
      id,
      agentId: "agent-a",
      tick: 1,
      type: "action",
      content,
      timestamp: new Date(),
    };
  }

  it("exposes adapter dimensions", () => {
    expect(manager.dimensions).toBe(8);
  });

  it("embeds a single entry and caches the embedding", async () => {
    const entry = makeEntry("1", "hello world");
    expect(entry.embedding).toBeUndefined();

    const embedding = await manager.embedEntry(entry);

    expect(embedding).toHaveLength(8);
    expect(entry.embedding).toEqual(embedding);
  });

  it("returns cached embedding if already present", async () => {
    const entry = makeEntry("1", "hello");
    entry.embedding = [1, 0, 0, 0, 0, 0, 0, 0];

    const embedding = await manager.embedEntry(entry);
    expect(embedding).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("batch embeds entries, skipping already-embedded ones", async () => {
    const e1 = makeEntry("1", "first");
    const e2 = makeEntry("2", "second");
    e2.embedding = [0, 1, 0, 0, 0, 0, 0, 0];

    const embeddings = await manager.embedEntries([e1, e2]);

    expect(embeddings).toHaveLength(2);
    expect(e1.embedding).toEqual(embeddings[0]);
    expect(embeddings[1]).toEqual([0, 1, 0, 0, 0, 0, 0, 0]);
  });

  it("embedText returns a raw embedding", async () => {
    const embedding = await manager.embedText("test query");
    expect(embedding).toHaveLength(8);
    const mag = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0));
    expect(mag).toBeCloseTo(1.0, 5);
  });
});
