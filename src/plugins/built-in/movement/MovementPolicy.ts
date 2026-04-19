import type { Asset } from "../../../types/AssetTypes.js";
import type { AgentProfile } from "../../../types/AgentTypes.js";
import type { GeoLocation } from "../../../types/LocationTypes.js";

export interface MovementRequest {
  agentId: string;
  /** Current location, or null/undefined if the agent has never been placed. */
  from: GeoLocation | null | undefined;
  to: GeoLocation;
  /** Haversine distance in meters between `from` and `to`. */
  distanceMeters: number;
  /** All assets owned by the agent (or reachable as household/community). */
  assets: Asset[];
  /** Agent profile, when available. */
  profile?: AgentProfile | undefined;
  /** Simulation tick the request happens on. */
  tick: number;
}

export interface MovementDecision {
  allowed: boolean;
  /** Label for the mode (e.g. "walking", "driving", "transit", or custom). */
  mode?: string | undefined;
  /** Human-readable reason, surfaced to the LLM when the move is denied. */
  reason?: string | undefined;
  /** Optional hint in ticks — integrators may use it to delay the arrival. */
  durationTicks?: number | undefined;
}

export type MovementPolicy = (
  req: MovementRequest,
) => MovementDecision | Promise<MovementDecision>;

export interface DefaultMovementPolicyOptions {
  /**
   * Max distance (meters) an agent can travel on foot in a single move.
   * Default: 1500 meters (≈ 15-20 minutes walk).
   */
  walkingRadiusMeters?: number | undefined;
}

/**
 * A reasonable default movement policy for integrators who don't plug their own.
 *
 * Rules:
 * 1. If the agent has no known `from` position, allow the move (the engine
 *    is simply placing them for the first time).
 * 2. If `distanceMeters <= walkingRadiusMeters` → allow as `walking`.
 * 3. Otherwise require an owned asset with `type === "vehicle"` → allow as
 *    `driving` (label derived from the vehicle's `metadata.mode` when set).
 * 4. Otherwise deny with a human-readable reason.
 *
 * This policy is intentionally minimal. Replace it via `WorldConfig.movementPolicy`
 * to model public transit, licenses, health/fitness signals, fuel, etc.
 */
export function defaultMovementPolicy(
  options: DefaultMovementPolicyOptions = {},
): MovementPolicy {
  const walkingRadiusMeters = options.walkingRadiusMeters ?? 1500;

  return (req: MovementRequest): MovementDecision => {
    if (req.from == null) {
      return { allowed: true, mode: "walking" };
    }

    if (req.distanceMeters <= walkingRadiusMeters) {
      return { allowed: true, mode: "walking" };
    }

    const ownedVehicle = req.assets.find(
      (a) => a.type === "vehicle" && a.owner === req.agentId && a.ownerType === "agent",
    );
    const householdVehicle = !ownedVehicle
      ? req.assets.find((a) => a.type === "vehicle" && a.ownerType === "household")
      : undefined;
    const vehicle = ownedVehicle ?? householdVehicle;

    if (vehicle) {
      const mode =
        (vehicle.metadata as { mode?: string } | undefined)?.mode
        ?? "driving";
      return { allowed: true, mode };
    }

    const km = (req.distanceMeters / 1000).toFixed(2);
    return {
      allowed: false,
      reason:
        `Distanza di ${km} km troppo lunga a piedi (limite ${(
          walkingRadiusMeters / 1000
        ).toFixed(1)} km) e non possiedi alcun veicolo.`,
    };
  };
}
