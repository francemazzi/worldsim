import type { StudioRouter } from "../StudioRouter.js";
import { json, readBody } from "../StudioRouter.js";
import type { VectorStore } from "../../types/VectorTypes.js";
import type { EmbeddingAdapter } from "../../types/VectorTypes.js";

export function registerVectorApi(
  router: StudioRouter,
  getVectorStore: () => VectorStore | undefined,
  getEmbeddingAdapter: () => EmbeddingAdapter | undefined,
): void {
  router.post("/api/search", async (req, res) => {
    const store = getVectorStore();
    const adapter = getEmbeddingAdapter();
    if (!store || !adapter) {
      json(res, { error: "VectorStore + EmbeddingAdapter not connected" }, 503);
      return;
    }

    const body = (await readBody(req)) as {
      query: string;
      agentId?: string;
      topK?: number;
    };

    if (!body.query) {
      json(res, { error: "Missing 'query' in request body" }, 400);
      return;
    }

    const embedding = await adapter.embed(body.query);
    const results = await store.search({
      agentId: body.agentId ?? "",
      embedding,
      topK: body.topK ?? 10,
    });

    json(res, {
      results: results.map((r) => ({
        content: r.entry.content,
        agentId: r.entry.agentId,
        score: r.score,
        metadata: r.entry.metadata,
        timestamp: r.entry.timestamp,
      })),
    });
  });
}
