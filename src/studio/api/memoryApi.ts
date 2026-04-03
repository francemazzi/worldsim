import type { StudioRouter } from "../StudioRouter.js";
import { json } from "../StudioRouter.js";
import type { MemoryStore, MemoryEntry } from "../../types/MemoryTypes.js";

export function registerMemoryApi(
  router: StudioRouter,
  getMemoryStore: () => MemoryStore | undefined,
): void {
  router.get("/api/agents/:id/memories", async (_req, res, params, query) => {
    const store = getMemoryStore();
    if (!store) {
      json(res, { error: "MemoryStore not connected" }, 503);
      return;
    }

    const agentId = params.id;
    if (!agentId) {
      json(res, { error: "Missing agent id" }, 400);
      return;
    }
    const limit = Math.min(parseInt(query.limit ?? "50", 10), 200);

    const memoryQuery: { agentId: string; limit?: number; types?: MemoryEntry["type"][]; since?: number } = {
      agentId,
      limit,
    };
    if (query.types) memoryQuery.types = query.types.split(",") as MemoryEntry["type"][];
    if (query.since) memoryQuery.since = parseInt(query.since, 10);

    const memories = await store.query(memoryQuery);

    json(res, { memories, count: memories.length });
  });
}
