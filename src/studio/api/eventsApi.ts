import type { StudioRouter } from "../StudioRouter.js";
import { json } from "../StudioRouter.js";
import type { WorldEngine } from "../../engine/WorldEngine.js";

export function registerEventsApi(
  router: StudioRouter,
  getEngine: (worldId?: string) => WorldEngine | null,
): void {
  router.get("/api/events", async (_req, res, _params, query) => {
    const engine = getEngine(query.worldId);
    if (!engine) {
      json(res, { error: "No engine connected" }, 503);
      return;
    }

    const limit = Math.min(parseInt(query.limit ?? "200", 10), 1000);
    const offset = parseInt(query.offset ?? "0", 10);
    const typeFilter = query.type ?? null;
    const agentFilter = query.agent ?? null;

    let events = [...engine.getEventLog()];

    if (typeFilter) {
      events = events.filter((e) => e.type === typeFilter);
    }
    if (agentFilter) {
      events = events.filter((e) => e.agentId === agentFilter);
    }

    // Newest first
    events.reverse();
    const total = events.length;
    const paged = events.slice(offset, offset + limit);

    json(res, { events: paged, total, limit, offset });
  });

  router.get("/api/world", async (_req, res, _params, query) => {
    const engine = getEngine(query.worldId);
    if (!engine) {
      json(res, { error: "No engine connected" }, 503);
      return;
    }

    const ctx = engine.getContext();
    const statuses = engine.getAgentStatuses();
    const agentCount = Object.keys(statuses).length;
    const activeCount = Object.values(statuses).filter((s) => s === "running" || s === "idle").length;

    json(res, {
      worldId: ctx.worldId,
      status: engine.getStatus(),
      tick: ctx.tickCount,
      startedAt: ctx.startedAt.toISOString(),
      agents: { total: agentCount, active: activeCount },
      eventCount: engine.getEventLog().length,
    });
  });
}
