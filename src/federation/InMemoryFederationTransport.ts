import type { FederationTransport } from "./FederationTransport.js";
import type {
  CrossWorldEnvelope,
  Unsubscribe,
  WorldNode,
} from "./types.js";

type Handler = (envelope: CrossWorldEnvelope) => Promise<void>;

/**
 * Single-process federation transport. All worlds share the same instance,
 * so `WorldA` publishing an envelope addressed to `worldB` invokes the
 * handler `worldB` registered via `subscribe`.
 *
 * Use for tests, demos, and single-node deployments. For multi-process
 * deployments use `RedisFederationTransport`.
 */
export class InMemoryFederationTransport implements FederationTransport {
  private handlers = new Map<string, Set<Handler>>();
  private nodes = new Map<string, WorldNode>();

  async publish(envelope: CrossWorldEnvelope): Promise<void> {
    const targets = this.handlers.get(envelope.toWorldId);
    if (!targets || targets.size === 0) return;
    // Snapshot to avoid mutation during iteration if a handler unsubscribes.
    const snapshot = [...targets];
    await Promise.all(snapshot.map((h) => h(envelope)));
  }

  async subscribe(
    worldId: string,
    handler: Handler,
  ): Promise<Unsubscribe> {
    let set = this.handlers.get(worldId);
    if (!set) {
      set = new Set();
      this.handlers.set(worldId, set);
    }
    set.add(handler);
    return () => {
      const current = this.handlers.get(worldId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.handlers.delete(worldId);
    };
  }

  async registerNode(node: WorldNode): Promise<void> {
    this.nodes.set(node.worldId, node);
  }

  async unregisterNode(worldId: string): Promise<void> {
    this.nodes.delete(worldId);
  }

  async listNodes(): Promise<WorldNode[]> {
    return [...this.nodes.values()];
  }
}
