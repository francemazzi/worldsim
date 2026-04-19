import type { GeoLocation } from "./LocationTypes.js";
import type { AssetStore } from "./AssetTypes.js";
import type { AgentRegistry } from "../agents/AgentRegistry.js";
import type { MovementPolicy } from "../plugins/built-in/movement/MovementPolicy.js";

export interface MovementRecord {
  agentId: string;
  from: GeoLocation | undefined;
  to: GeoLocation;
  tick: number;
  source: "agent_tool" | "external_gps";
  timestamp: Date;
  /** Mode returned by the active MovementPolicy (e.g. "walking", "driving"). */
  mode?: string | undefined;
}

export interface MovementPluginOptions {
  /** Maximum movement history entries per agent. Default: 50 */
  maxHistoryPerAgent?: number | undefined;
  /** Default search radius for find_nearby_agents in km. Default: 5 */
  defaultNearbyRadiusKm?: number | undefined;
  /**
   * Movement policy that decides whether a move is allowed and, if so, which
   * "mode" it uses. If omitted, `defaultMovementPolicy` is applied.
   */
  policy?: MovementPolicy | undefined;
  /**
   * Walking radius (meters) used by the default policy. Ignored when a
   * custom `policy` is provided. Default: 1500.
   */
  walkingRadiusMeters?: number | undefined;
  /**
   * Asset store used by the policy to look up vehicles (or any other asset).
   * When omitted, the policy receives an empty `assets` array — meaning the
   * default policy will only allow walking.
   */
  assetStore?: AssetStore | undefined;
  /**
   * Optional agent registry, used to enrich the policy request with the
   * agent's profile (for policies that read `profession`, `age`, custom
   * fields, etc.).
   */
  agentRegistry?: AgentRegistry | undefined;
}
