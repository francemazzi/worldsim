import Redis, { type Redis as RedisType } from "ioredis";

import type { FederationTransport } from "./FederationTransport.js";
import type {
  CrossWorldEnvelope,
  Unsubscribe,
  WorldNode,
} from "./types.js";

const MSG_CHANNEL_PREFIX = "worldsim:fed:msg:";
const NODES_KEY = "worldsim:fed:nodes";

type Handler = (envelope: CrossWorldEnvelope) => Promise<void>;

export interface RedisFederationTransportOptions {
  /** Redis connection URL. Defaults to `redis://localhost:6379`. */
  redisUrl?: string;
  /** Inject an existing publisher client. Useful in tests / shared connection setups. */
  publisherClient?: RedisType;
  /** Inject an existing subscriber client. MUST be a different connection than the publisher. */
  subscriberClient?: RedisType;
}

/**
 * Multi-process federation transport built on Redis Pub/Sub.
 *
 * - Each world subscribes to `worldsim:fed:msg:{worldId}` and receives
 *   envelopes addressed to it. The `FederationBus` then queues them for
 *   the next local tick.
 * - The world-node registry lives in a single Redis hash (`worldsim:fed:nodes`)
 *   so any process can list active worlds with one round-trip.
 *
 * Ordering: Redis Pub/Sub does not preserve order across publishers. SMS-style
 * traffic is unaffected; phase 3 calls may need a stronger transport.
 *
 * Security: deploy this transport on a private network or use TLS — there is
 * no authentication or encryption at the Pub/Sub layer.
 */
export class RedisFederationTransport implements FederationTransport {
  private readonly publisher: RedisType;
  private readonly subscriber: RedisType;
  private readonly ownClients: boolean;
  private readonly handlers = new Map<string, Set<Handler>>();

  constructor(options: RedisFederationTransportOptions = {}) {
    if (options.publisherClient && options.subscriberClient) {
      if (options.publisherClient === options.subscriberClient) {
        throw new Error(
          "[RedisFederationTransport] publisherClient and subscriberClient must be distinct connections",
        );
      }
      this.publisher = options.publisherClient;
      this.subscriber = options.subscriberClient;
      this.ownClients = false;
    } else {
      const url = options.redisUrl ?? "redis://localhost:6379";
      this.publisher = new Redis(url);
      this.subscriber = new Redis(url);
      this.ownClients = true;
    }

    this.subscriber.on("message", (channel: string, raw: string) => {
      if (!channel.startsWith(MSG_CHANNEL_PREFIX)) return;
      const worldId = channel.slice(MSG_CHANNEL_PREFIX.length);
      const handlers = this.handlers.get(worldId);
      if (!handlers || handlers.size === 0) return;
      let envelope: CrossWorldEnvelope;
      try {
        envelope = JSON.parse(raw) as CrossWorldEnvelope;
      } catch {
        console.warn("[RedisFederationTransport] dropped malformed payload");
        return;
      }
      // Snapshot to tolerate handler unsubscriptions during iteration.
      for (const handler of [...handlers]) {
        handler(envelope).catch((err: unknown) => {
          console.warn("[RedisFederationTransport] handler threw:", err);
        });
      }
    });
  }

  async publish(envelope: CrossWorldEnvelope): Promise<void> {
    const channel = MSG_CHANNEL_PREFIX + envelope.toWorldId;
    await this.publisher.publish(channel, JSON.stringify(envelope));
  }

  async subscribe(
    worldId: string,
    handler: Handler,
  ): Promise<Unsubscribe> {
    let set = this.handlers.get(worldId);
    if (!set) {
      set = new Set();
      this.handlers.set(worldId, set);
      await this.subscriber.subscribe(MSG_CHANNEL_PREFIX + worldId);
    }
    set.add(handler);

    return async () => {
      const current = this.handlers.get(worldId);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.handlers.delete(worldId);
        try {
          await this.subscriber.unsubscribe(MSG_CHANNEL_PREFIX + worldId);
        } catch (err) {
          console.warn("[RedisFederationTransport] unsubscribe threw:", err);
        }
      }
    };
  }

  async registerNode(node: WorldNode): Promise<void> {
    await this.publisher.hset(NODES_KEY, node.worldId, JSON.stringify(node));
  }

  async unregisterNode(worldId: string): Promise<void> {
    await this.publisher.hdel(NODES_KEY, worldId);
  }

  async listNodes(): Promise<WorldNode[]> {
    const all = await this.publisher.hgetall(NODES_KEY);
    const out: WorldNode[] = [];
    for (const value of Object.values(all)) {
      try {
        out.push(JSON.parse(value) as WorldNode);
      } catch {
        // Skip malformed entries silently — they cannot be acted upon.
      }
    }
    return out;
  }

  /**
   * Closes the publisher and subscriber clients. Only effective when the
   * transport created its own clients (i.e. neither `publisherClient` nor
   * `subscriberClient` was injected).
   */
  async close(): Promise<void> {
    if (!this.ownClients) return;
    try {
      await this.publisher.quit();
    } catch {
      // ignore
    }
    try {
      await this.subscriber.quit();
    } catch {
      // ignore
    }
  }
}
