import type { GeoLocation } from "./LocationTypes.js";

export interface MovementRecord {
  agentId: string;
  from: GeoLocation | undefined;
  to: GeoLocation;
  tick: number;
  source: "agent_tool" | "external_gps";
  timestamp: Date;
}

export interface MovementPluginOptions {
  /** Maximum movement history entries per agent. Default: 50 */
  maxHistoryPerAgent?: number | undefined;
  /** Default search radius for find_nearby_agents in km. Default: 5 */
  defaultNearbyRadiusKm?: number | undefined;
}
