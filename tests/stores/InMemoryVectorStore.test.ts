import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryVectorStore } from "../helpers/InMemoryVectorStore.js";
import { FakeEmbeddingAdapter } from "../helpers/FakeEmbeddingAdapter.js";
import type { VectorEntry } from "../../src/types/VectorTypes.js";

describe("InMemoryVectorStore", () => {
  let store: InMemoryVectorStore;
  let embedder: FakeEmbeddingAdapter;

  beforeEach(() => {
    store = new InMemoryVectorStore();
    embedder = new FakeEmbeddingAdapter(8);
  });

  function makeEntry(
    id: string,
    agentId: string,
    content: string,
    embedding: number[],
  ): VectorEntry {
    return {
      id,
      agentId,
      content,
      embedding,
      timestamp: new Date(),
    };
  }

  it("upserts and retrieves by similarity", async () => {
    const emb1 = await embedder.embed("the cat sat on the mat");
    const emb2 = await embedder.embed("the dog ran in the park");
    const emb3 = await embedder.embed("the cat sat on the rug");

    await store.upsertBatch([
      makeEntry("1", "agent-a", "the cat sat on the mat", emb1),
      makeEntry("2", "agent-a", "the dog ran in the park", emb2),
      makeEntry("3", "agent-a", "the cat sat on the rug", emb3),
    ]);

    const queryEmb = await embedder.embed("the cat sat on the mat");
    const results = await store.search({
      agentId: "agent-a",
      embedding: queryEmb,
      topK: 2,
    });

    expect(results).toHaveLength(2);
    expect(results[0]!.entry.id).toBe("1");
    expect(results[0]!.score).toBeCloseTo(1.0, 5);
  });

  it("filters by agentId", async () => {
    const emb = await embedder.embed("hello world");

    await store.upsert(makeEntry("1", "agent-a", "hello world", emb));
    await store.upsert(makeEntry("2", "agent-b", "hello world", emb));

    const results = await store.search({
      agentId: "agent-a",
      embedding: emb,
      topK: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.entry.agentId).toBe("agent-a");
  });

  it("respects minScore threshold", async () => {
    const emb1 = await embedder.embed("alpha");
    const emb2 = await embedder.embed("completely different sentence with unique words");

    await store.upsertBatch([
      makeEntry("1", "agent-a", "alpha", emb1),
      makeEntry("2", "agent-a", "different", emb2),
    ]);

    const results = await store.search({
      agentId: "agent-a",
      embedding: emb1,
      topK: 10,
      minScore: 0.99,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.entry.id).toBe("1");
  });

  it("filters by metadata", async () => {
    const emb = await embedder.embed("test");

    await store.upsert({
      ...makeEntry("1", "agent-a", "test", emb),
      metadata: { type: "action" },
    });
    await store.upsert({
      ...makeEntry("2", "agent-a", "test", emb),
      metadata: { type: "reflection" },
    });

    const results = await store.search({
      agentId: "agent-a",
      embedding: emb,
      topK: 10,
      filter: { type: "reflection" },
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.entry.id).toBe("2");
  });

  it("deletes entries for a specific agent", async () => {
    const emb = await embedder.embed("test");
    await store.upsert(makeEntry("1", "agent-a", "test", emb));
    await store.upsert(makeEntry("2", "agent-a", "test2", emb));

    await store.delete("agent-a", ["1"]);

    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0]!.id).toBe("2");
  });

  it("clears all entries for an agent", async () => {
    const emb = await embedder.embed("test");
    await store.upsert(makeEntry("1", "agent-a", "t1", emb));
    await store.upsert(makeEntry("2", "agent-a", "t2", emb));
    await store.upsert(makeEntry("3", "agent-b", "t3", emb));

    await store.clear("agent-a");

    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0]!.agentId).toBe("agent-b");
  });

  it("returns empty when no embedding is provided", async () => {
    const emb = await embedder.embed("test");
    await store.upsert(makeEntry("1", "agent-a", "test", emb));

    const results = await store.search({
      agentId: "agent-a",
      text: "test",
    });

    expect(results).toHaveLength(0);
  });

  it("upsert overwrites existing entry", async () => {
    const emb1 = await embedder.embed("original");
    const emb2 = await embedder.embed("updated");

    await store.upsert(makeEntry("1", "agent-a", "original", emb1));
    await store.upsert(makeEntry("1", "agent-a", "updated", emb2));

    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0]!.content).toBe("updated");
  });
});

describe("FakeEmbeddingAdapter", () => {
  it("produces deterministic embeddings", async () => {
    const adapter = new FakeEmbeddingAdapter(8);
    const emb1 = await adapter.embed("hello");
    const emb2 = await adapter.embed("hello");
    expect(emb1).toEqual(emb2);
  });

  it("produces embeddings of configured dimensions", async () => {
    const adapter = new FakeEmbeddingAdapter(16);
    const emb = await adapter.embed("test");
    expect(emb).toHaveLength(16);
  });

  it("produces unit vectors", async () => {
    const adapter = new FakeEmbeddingAdapter(8);
    const emb = await adapter.embed("some text");
    const magnitude = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
    expect(magnitude).toBeCloseTo(1.0, 5);
  });

  it("embedBatch returns one embedding per input", async () => {
    const adapter = new FakeEmbeddingAdapter(8);
    const results = await adapter.embedBatch(["a", "b", "c"]);
    expect(results).toHaveLength(3);
  });
});
