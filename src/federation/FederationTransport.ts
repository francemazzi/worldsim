import type {
  CrossWorldEnvelope,
  Unsubscribe,
  WorldNode,
} from "./types.js";

/**
 * Pluggable transport for cross-world envelopes. Implementations:
 * - {@link InMemoryFederationTransport} — single-process, no I/O.
 * - {@link RedisFederationTransport} — Redis Pub/Sub for multi-process deployments.
 *
 * The transport is responsible for:
 * - Delivering envelopes to the destination world (by `worldId`).
 * - Maintaining the world-node registry consulted by `listNodes`.
 *
 * The transport does NOT validate envelope contents — that is the
 * `FederationBus`'s job (see Zod schemas in `./schemas.ts`).
 */
export interface FederationTransport {
  publish(envelope: CrossWorldEnvelope): Promise<void>;
  subscribe(
    worldId: string,
    handler: (envelope: CrossWorldEnvelope) => Promise<void>,
  ): Promise<Unsubscribe>;
  registerNode(node: WorldNode): Promise<void>;
  unregisterNode(worldId: string): Promise<void>;
  listNodes(): Promise<WorldNode[]>;
}
