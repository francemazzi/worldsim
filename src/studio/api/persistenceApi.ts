import type { StudioRouter } from "../StudioRouter.js";
import { json } from "../StudioRouter.js";
import type { PersistenceStore } from "../../types/PersistenceTypes.js";
import type { WorldEngine } from "../../engine/WorldEngine.js";

export function registerPersistenceApi(
  router: StudioRouter,
  getPersistenceStore: () => PersistenceStore | undefined,
  getEngine: (worldId?: string) => WorldEngine | null,
): void {
  router.get("/api/conversations", async (_req, res, _params, query) => {
    const store = getPersistenceStore();
    const engine = getEngine(query.worldId);
    if (!store) {
      json(res, { error: "PersistenceStore not connected" }, 503);
      return;
    }

    const worldId = engine?.getContext().worldId ?? query.worldId ?? "";
    const limit = Math.min(parseInt(query.limit ?? "50", 10), 200);
    const agentId = query.agent;

    const opts: { limit?: number; agentId?: string } = { limit };
    if (agentId) opts.agentId = agentId;

    const conversations = await store.getConversations(worldId, opts);

    json(res, { conversations });
  });

  router.get("/api/agents/:id/snapshots", async (_req, res, params, query) => {
    const store = getPersistenceStore();
    const engine = getEngine(query.worldId);
    if (!store) {
      json(res, { error: "PersistenceStore not connected" }, 503);
      return;
    }

    const agentId = params.id;
    if (!agentId) {
      json(res, { error: "Missing agent id" }, 400);
      return;
    }
    const worldId = engine?.getContext().worldId ?? query.worldId ?? "";
    const limit = Math.min(parseInt(query.limit ?? "20", 10), 100);

    const snapshots = await store.getStateHistory(agentId, worldId, limit);

    json(res, { snapshots });
  });
}
