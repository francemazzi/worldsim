import type { WorldContext } from "../types/WorldTypes.js";

export function createWorldContext(worldId: string): WorldContext {
  return {
    worldId,
    tickCount: 0,
    startedAt: new Date(),
    metadata: {},
  };
}
