import type { LocationIndex } from "../location/LocationIndex.js";
import type { Percept } from "../types/PerceptionTypes.js";
import type { PerceptionFilter } from "../types/PerceptionTypes.js";

export interface VenueLineOfSightOptions {
  /** Labels that count as open/shared (no wall between agents). */
  sharedVenueLabels: string[];
  /** Channels blocked by venue walls. Default: sound + sight. */
  blockedChannels?: Array<"sound" | "sight"> | undefined;
}

/**
 * Creates a {@link PerceptionFilter} that blocks cross-venue perception when
 * two agents occupy different enclosed venue labels. Shared labels (e.g.
 * corridoio, piazza) allow perception as usual.
 *
 * Agents without a location label pass through unchanged.
 */
export function createVenueLineOfSightFilter(
  locationIndex: LocationIndex,
  sharedVenueLabels: string[],
  options: Omit<VenueLineOfSightOptions, "sharedVenueLabels"> = {},
): PerceptionFilter {
  const shared = new Set(sharedVenueLabels.map((l) => l.toLowerCase()));
  const blocked = new Set(options.blockedChannels ?? ["sound", "sight"]);

  return (percept, agentId) => {
    if (!blocked.has(percept.via as "sound" | "sight")) return true;
    const source = percept.stimulus.source;
    if (source.kind !== "agent") return true;

    const agentLoc = locationIndex.getLocation(agentId);
    const sourceLoc = locationIndex.getLocation(source.id);
    if (!agentLoc?.label || !sourceLoc?.label) return true;

    const agentVenue = agentLoc.label.toLowerCase();
    const sourceVenue = sourceLoc.label.toLowerCase();
    if (agentVenue === sourceVenue) return true;
    if (shared.has(agentVenue) || shared.has(sourceVenue)) return true;

    return false;
  };
}
