import type { NeedsTracker } from "./NeedsTracker.js";
import type { LocationIndex } from "../location/LocationIndex.js";
import type { AffordanceResolver } from "../entities/AffordanceResolver.js";
import type { Percept } from "../types/PerceptionTypes.js";
import { haversineKm } from "../location/LocationIndex.js";

export interface NeedDestinationHint {
  entityId: string;
  entityName: string;
  verb: string;
  label?: string | undefined;
  distanceKm: number;
  needId: string;
}

const AFFORDANCE_NEED_MAP: Record<string, string> = {
  eat: "hunger",
  drink: "thirst",
  sit: "fatigue",
  rest: "fatigue",
  sleep: "fatigue",
  pet: "social",
  talk: "social",
};

/**
 * Suggests entity affordances that could satisfy the agent's active or
 * critical needs. Used to populate `--- DESTINAZIONI UTILI ---` in the prompt.
 */
export function computeNeedDestinationHints(
  agentId: string,
  deps: {
    needsTracker: NeedsTracker;
    affordanceResolver: AffordanceResolver;
    locationIndex: LocationIndex;
    percepts: Percept[];
  },
): NeedDestinationHint[] {
  const ns = deps.needsTracker.get(agentId);
  if (!ns) return [];

  const urgentNeedIds = new Set<string>();
  for (const n of deps.needsTracker.activeNeeds(agentId)) {
    urgentNeedIds.add(n.id);
  }
  for (const n of deps.needsTracker.criticalNeeds(agentId)) {
    urgentNeedIds.add(n.id);
  }
  if (urgentNeedIds.size === 0) return [];

  const agentLoc = deps.locationIndex.get(agentId);
  const affordances = deps.affordanceResolver.fromPercepts(deps.percepts);
  const hints: NeedDestinationHint[] = [];
  const seen = new Set<string>();

  for (const item of affordances) {
    const needId = AFFORDANCE_NEED_MAP[item.affordance.verb];
    if (!needId || !urgentNeedIds.has(needId)) continue;
    const key = `${item.entity.id}:${item.affordance.verb}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let distanceKm = 0;
    if (agentLoc && item.entity.position) {
      distanceKm = haversineKm(agentLoc, item.entity.position);
    }

    hints.push({
      entityId: item.entity.id,
      entityName: item.entity.name ?? item.entity.id,
      verb: item.affordance.verb,
      ...(item.entity.position?.label ? { label: item.entity.position.label } : {}),
      distanceKm,
      needId,
    });
  }

  hints.sort((a, b) => a.distanceKm - b.distanceKm);
  return hints.slice(0, 6);
}

export function buildNeedDestinationsPrompt(hints: NeedDestinationHint[]): string {
  if (hints.length === 0) return "";
  const lines = hints.map((h) => {
    const dist = h.distanceKm > 0 ? ` (~${(h.distanceKm * 1000).toFixed(0)}m)` : "";
    const place = h.label ? ` @ ${h.label}` : "";
    return `  - ${h.verb} su ${h.entityName} (${h.entityId})${place}${dist} → soddisfa ${h.needId}`;
  });
  return `--- DESTINAZIONI UTILI ---\n${lines.join("\n")}`;
}
