import type { WorldSimPlugin } from "../../types/PluginTypes.js";

/**
 * Capability interface for plugins that can push real-world GPS positions
 * into the simulation. The engine uses this to route `updateAgentPosition`
 * calls without knowing about any concrete plugin class.
 */
export interface PositionProvider {
  updateRealPosition(
    agentId: string,
    latitude: number,
    longitude: number,
    label?: string,
  ): void;
}

/**
 * Type guard that detects plugins exposing the PositionProvider capability.
 */
export function isPositionProvider(
  p: WorldSimPlugin,
): p is WorldSimPlugin & PositionProvider {
  return (
    typeof (p as Partial<PositionProvider>).updateRealPosition === "function"
  );
}
