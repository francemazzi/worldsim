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
      tuning: {
        defaultActiveTickRatio: engine.getConfig().defaultActiveTickRatio ?? 1,
        controlSamplingRate: engine.getConfig().controlSamplingRate ?? 1,
        enableResponseCache: engine.getConfig().enableResponseCache ?? false,
        responseCacheTtl: engine.getConfig().responseCacheTtl ?? 5,
      },
    });
  });

  router.get("/api/tuning/agents", async (_req, res, _params, query) => {
    const engine = getEngine(query.worldId);
    if (!engine) {
      json(res, { error: "No engine connected" }, 503);
      return;
    }
    const alerts = engine.getConfig().observability?.alerts;
    const agents = Object.keys(engine.getAgentStatuses()).map((agentId) => {
      const usage = engine.getTokenUsage(agentId);
      const avgLatencyMs = usage && usage.lifetimeRequests > 0
        ? usage.totalLatencyMs / usage.lifetimeRequests
        : 0;
      const warnings: string[] = [];
      if (alerts?.maxAvgLatencyMs != null && avgLatencyMs > alerts.maxAvgLatencyMs) {
        warnings.push("latency_outlier");
      }
      if (alerts?.maxLifetimeTokens != null && (usage?.lifetimeTokens ?? 0) > alerts.maxLifetimeTokens) {
        warnings.push("token_outlier");
      }
      return {
        agentId,
        usage: usage ?? null,
        avgLatencyMs: Math.round(avgLatencyMs * 10) / 10,
        warnings,
        recommendations: [
          "consider_light_llm_tier",
          "tighten_token_budget",
          "increase_cooldown_or_reduce_active_ratio",
          "reduce_control_sampling_rate_if_safe",
        ],
      };
    });
    json(res, { agents });
  });
}
