import type { StudioRouter } from "../StudioRouter.js";
import { json } from "../StudioRouter.js";
import type { GraphStore } from "../../types/GraphTypes.js";
import type { WorldEngine } from "../../engine/WorldEngine.js";

export function registerGraphApi(
  router: StudioRouter,
  getGraphStore: () => GraphStore | undefined,
  getEngine: () => WorldEngine | null,
): void {
  // Full relationship graph (all agents)
  router.get("/api/graph", async (_req, res) => {
    const store = getGraphStore();
    const engine = getEngine();
    if (!store) {
      json(res, { error: "GraphStore not connected" }, 503);
      return;
    }
    if (!engine) {
      json(res, { error: "No engine connected" }, 503);
      return;
    }

    const statuses = engine.getAgentStatuses();
    const agentIds = Object.keys(statuses);

    // Collect all relationships from all agents
    const seen = new Set<string>();
    const relationships: Array<{
      from: string;
      to: string;
      type: string;
      strength: number;
      since: number;
      lastInteraction?: number | undefined;
      group?: string | undefined;
    }> = [];

    for (const agentId of agentIds) {
      const rels = await store.getRelationships({ agentId });
      for (const rel of rels) {
        const key = [rel.from, rel.to, rel.type].sort().join("|");
        if (!seen.has(key)) {
          seen.add(key);
          relationships.push({
            from: rel.from,
            to: rel.to,
            type: rel.type,
            strength: rel.strength,
            since: rel.since,
            lastInteraction: rel.lastInteraction,
            group: rel.group,
          });
        }
      }
    }

    // Build nodes with names
    const nodes = agentIds.map((id) => {
      const agent = engine.getAgent(id);
      return {
        id,
        name: agent?.getProfile()?.name ?? id,
        role: agent?.role ?? "person",
        status: statuses[id],
      };
    });

    json(res, { nodes, relationships });
  });

  // Relationships for a single agent
  router.get("/api/agents/:id/relationships", async (_req, res, params, query) => {
    const store = getGraphStore();
    if (!store) {
      json(res, { error: "GraphStore not connected" }, 503);
      return;
    }

    const agentId = params.id;
    if (!agentId) {
      json(res, { error: "Missing agent id" }, 400);
      return;
    }
    const minStrengthStr = query.minStrength;

    const queryObj: { agentId: string; minStrength?: number } = { agentId };
    if (minStrengthStr) queryObj.minStrength = parseFloat(minStrengthStr);

    const relationships = await store.getRelationships(queryObj);

    json(res, { relationships });
  });
}
