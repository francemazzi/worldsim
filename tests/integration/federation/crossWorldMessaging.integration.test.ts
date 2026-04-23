import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Redis from "ioredis";
import { MessageBus, createMessageId } from "../../../src/messaging/MessageBus.js";
import { PluginRegistry } from "../../../src/plugins/PluginRegistry.js";
import { FederationBus } from "../../../src/federation/FederationBus.js";
import { RedisFederationTransport } from "../../../src/federation/RedisFederationTransport.js";
import type { WorldNode } from "../../../src/federation/types.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:16399";

const node = (worldId: string): WorldNode => ({
  worldId,
  displayName: worldId,
  capabilities: ["messaging"],
});

interface Side {
  bus: MessageBus;
  fed: FederationBus;
  transport: RedisFederationTransport;
  tick: { current: number };
  knownAgents: Set<string>;
}

async function makeSide(
  worldId: string,
  knownAgents: string[] = [],
): Promise<Side> {
  const transport = new RedisFederationTransport({ redisUrl: REDIS_URL });
  const bus = new MessageBus();
  const plugins = new PluginRegistry();
  const tick = { current: 0 };
  const set = new Set(knownAgents);
  const fed = new FederationBus({
    worldNode: node(worldId),
    transport,
    messageBus: bus,
    pluginRegistry: plugins,
    getCurrentTick: () => tick.current,
    hasLocalAgent: (id) => set.has(id),
  });
  await fed.start();
  return { bus, fed, transport, tick, knownAgents: set };
}

async function flushRedis(): Promise<void> {
  const r = new Redis(REDIS_URL);
  try {
    await r.flushdb();
  } finally {
    await r.quit();
  }
}

describe.skipIf(!process.env.REDIS_URL && !process.env.CI)(
  "RedisFederationTransport integration",
  () => {
    let firenze: Side;
    let roma: Side;

    beforeAll(async () => {
      await flushRedis();
      // Two independent transports → emulate two processes against the same Redis.
      firenze = await makeSide("firenze");
      roma = await makeSide("roma", ["luca"]);
    });

    afterAll(async () => {
      await firenze?.fed.stop();
      await roma?.fed.stop();
      await firenze?.transport.close();
      await roma?.transport.close();
    });

    it("listNodes() reports both worlds after start()", async () => {
      const nodes = await firenze.transport.listNodes();
      const ids = nodes.map((n) => n.worldId).sort();
      expect(ids).toEqual(["firenze", "roma"]);
    });

    it("delivers a cross-world SMS via Redis Pub/Sub", async () => {
      firenze.tick.current = 5;
      firenze.bus.newTick(5);
      firenze.bus.publish({
        id: createMessageId(),
        from: "maria",
        to: "roma:luca",
        type: "sms",
        content: "ciao da firenze",
        tick: 5,
        metadata: { federationChannel: "sms" },
      });

      // Wait for Redis round-trip + microtask flush.
      await waitFor(() => roma.fed.inboundSize() > 0, 5_000);
      expect(roma.fed.inboundSize()).toBeGreaterThan(0);

      roma.tick.current = 6;
      roma.bus.newTick(6);
      await roma.fed.drainInbound(6);

      const inbox = roma.bus.getMessages("luca", 6);
      expect(inbox).toHaveLength(1);
      expect(inbox[0]?.content).toBe("ciao da firenze");
      expect(inbox[0]?.metadata?.sourceWorld).toBe("firenze");
    });

    it("drops envelopes addressed to unknown agents (no crash)", async () => {
      firenze.tick.current = 7;
      firenze.bus.newTick(7);
      firenze.bus.publish({
        id: createMessageId(),
        from: "maria",
        to: "roma:fantasma",
        type: "sms",
        content: "?",
        tick: 7,
        metadata: { federationChannel: "sms" },
      });

      await waitFor(() => roma.fed.inboundSize() > 0, 5_000);
      roma.tick.current = 8;
      roma.bus.newTick(8);
      await roma.fed.drainInbound(8);

      // The single dropped envelope should NOT have produced any local message.
      expect(roma.bus.getMessages("fantasma", 8)).toHaveLength(0);
    });
  },
);

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}
