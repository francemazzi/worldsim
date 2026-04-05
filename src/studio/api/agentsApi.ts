import type { StudioRouter } from "../StudioRouter.js";
import { json } from "../StudioRouter.js";
import type { WorldEngine } from "../../engine/WorldEngine.js";

export function registerAgentsApi(
  router: StudioRouter,
  getEngine: (worldId?: string) => WorldEngine | null,
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
    });
  });
}
