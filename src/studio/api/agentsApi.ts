import type { StudioRouter } from "../StudioRouter.js";
import { json } from "../StudioRouter.js";
import type { WorldEngine } from "../../engine/WorldEngine.js";
import type { PersistenceStore } from "../../types/PersistenceTypes.js";
import type { GraphStore } from "../../types/GraphTypes.js";

export function registerAgentsApi(
  router: StudioRouter,
  getEngine: (worldId?: string) => WorldEngine | null,
  getPersistenceStore?: (() => PersistenceStore | undefined) | undefined,
  getGraphStore?: (() => GraphStore | undefined) | undefined,
): void {
  router.get("/api/agents", async (_req, res, _params, query) => {
    const engine = getEngine(query.worldId);
    if (!engine) {
      json(res, { error: "No engine connected" }, 503);
      return;
    }

    const statuses = engine.getAgentStatuses();
    const agents = Object.entries(statuses).map(([id, status]) => {
      const agent = engine.getAgent(id);
      return {
        id,
        status,
        name: agent?.getProfile()?.name ?? id,
        role: agent?.role ?? "person",
        profile: agent?.getProfile() ?? null,
        state: agent?.getInternalState() ?? null,
      };
    });

    json(res, { agents });
  });

  router.get("/api/agents/:id", async (_req, res, params, query) => {
    const engine = getEngine(query.worldId);
    if (!engine) {
      json(res, { error: "No engine connected" }, 503);
      return;
    }

    const agentId = params.id;
    if (!agentId) {
      json(res, { error: "Missing agent id" }, 400);
      return;
    }
    const agent = engine.getAgent(agentId);
    if (!agent) {
      json(res, { error: "Agent not found" }, 404);
      return;
    }

    json(res, {
      id: agent.id,
      role: agent.role,
      status: agent.status,
      isActive: agent.isActive,
      profile: agent.getProfile() ?? null,
      state: agent.getInternalState(),
      tokenUsage: engine.getTokenUsage(agent.id) ?? null,
    });
  });

  router.get("/api/agents/:id/observability", async (_req, res, params, query) => {
    const engine = getEngine(query.worldId);
    if (!engine) {
      json(res, { error: "No engine connected" }, 503);
      return;
    }
    const agentId = params.id;
    if (!agentId) {
      json(res, { error: "Missing agent id" }, 400);
      return;
    }
    const agent = engine.getAgent(agentId);
    if (!agent) {
      json(res, { error: "Agent not found" }, 404);
      return;
    }
    const worldId = engine.getContext().worldId;
    const tokenUsage = engine.getTokenUsage(agentId) ?? null;
    const avgLatencyMs = tokenUsage && tokenUsage.lifetimeRequests > 0
      ? Math.round((tokenUsage.totalLatencyMs / tokenUsage.lifetimeRequests) * 10) / 10
      : 0;

    let storage: unknown = null;
    const persistence = getPersistenceStore?.();
    if (persistence?.estimateAgentStorageUsage) {
      storage = await persistence.estimateAgentStorageUsage(agentId, worldId);
    }

    let graph: { relationships: number; averageStrength: number } | null = null;
    const graphStore = getGraphStore?.();
    if (graphStore) {
      const relationships = await graphStore.getRelationships({ agentId });
      const averageStrength = relationships.length > 0
        ? relationships.reduce((sum, rel) => sum + rel.strength, 0) / relationships.length
        : 0;
      graph = {
        relationships: relationships.length,
        averageStrength: Math.round(averageStrength * 1000) / 1000,
      };
    }

    json(res, {
      agentId,
      worldId,
      tokenUsage,
      latency: {
        avgMs: avgLatencyMs,
        lastMs: tokenUsage?.lastLatencyMs ?? 0,
        maxMs: tokenUsage?.maxLatencyMs ?? 0,
      },
      storage,
      graph,
    });
  });
}
