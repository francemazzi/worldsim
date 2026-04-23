import type { FederatedAgentId } from "./types.js";

const SEPARATOR = ":";

export function format(worldId: string, agentId: string): FederatedAgentId {
  if (worldId.length === 0 || agentId.length === 0) {
    throw new Error(
      `FederatedAgentId requires non-empty worldId and agentId (got "${worldId}":"${agentId}")`,
    );
  }
  if (worldId.includes(SEPARATOR)) {
    throw new Error(
      `FederatedAgentId worldId must not contain "${SEPARATOR}" (got "${worldId}")`,
    );
  }
  return `${worldId}${SEPARATOR}${agentId}` as FederatedAgentId;
}

export function parse(
  id: string,
): { worldId: string; agentId: string } | null {
  const sepIndex = id.indexOf(SEPARATOR);
  if (sepIndex <= 0 || sepIndex === id.length - 1) return null;
  const worldId = id.slice(0, sepIndex);
  const agentId = id.slice(sepIndex + 1);
  return { worldId, agentId };
}

export function isFederatedAgentId(id: string): id is FederatedAgentId {
  return parse(id) !== null;
}

/**
 * Returns true when `id` is a federated id whose world prefix differs
 * from `localWorldId`. Used by the MessageBus routing layer to decide
 * whether a publish should be delegated to the FederationBus.
 */
export function isExternal(id: string, localWorldId: string): boolean {
  const parsed = parse(id);
  if (parsed === null) return false;
  return parsed.worldId !== localWorldId;
}

/**
 * If `id` is a federated id whose world prefix matches `localWorldId`,
 * returns the bare local agentId. Otherwise returns `id` unchanged.
 */
export function stripLocalPrefix(id: string, localWorldId: string): string {
  const parsed = parse(id);
  if (parsed === null) return id;
  if (parsed.worldId !== localWorldId) return id;
  return parsed.agentId;
}
