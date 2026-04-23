import { describe, expect, it } from "vitest";
import { InMemoryFederationTransport } from "../../src/federation/InMemoryFederationTransport.js";
import type {
  CrossWorldEnvelope,
  WorldNode,
} from "../../src/federation/types.js";

function envelope(toWorldId: string, id = "env-1"): CrossWorldEnvelope {
  return {
    id,
    fromWorldId: "firenze",
    toWorldId,
    fromAgentId: "maria",
    toAgentId: "luca",
    channel: "sms",
    payload: { content: "ciao" },
    sentAtTick: 1,
    sentAtRealTime: "2026-04-24T00:00:00.000Z",
  };
}

function node(worldId: string, displayName = worldId): WorldNode {
  return {
    worldId,
    displayName,
    capabilities: ["messaging"],
  };
}

describe("InMemoryFederationTransport", () => {
  it("delivers a published envelope to a subscribed handler", async () => {
    const transport = new InMemoryFederationTransport();
    const received: CrossWorldEnvelope[] = [];
    await transport.subscribe("roma", async (env) => {
      received.push(env);
    });
    await transport.publish(envelope("roma"));
    expect(received).toHaveLength(1);
    expect(received[0]?.id).toBe("env-1");
  });

  it("delivers to multiple handlers for the same world", async () => {
    const transport = new InMemoryFederationTransport();
    let count = 0;
    await transport.subscribe("roma", async () => { count += 1; });
    await transport.subscribe("roma", async () => { count += 1; });
    await transport.publish(envelope("roma"));
    expect(count).toBe(2);
  });

  it("ignores envelopes with no subscribers for the destination", async () => {
    const transport = new InMemoryFederationTransport();
    await expect(transport.publish(envelope("milano"))).resolves.toBeUndefined();
  });

  it("stops delivering after unsubscribe", async () => {
    const transport = new InMemoryFederationTransport();
    let count = 0;
    const off = await transport.subscribe("roma", async () => { count += 1; });
    await transport.publish(envelope("roma", "env-a"));
    await off();
    await transport.publish(envelope("roma", "env-b"));
    expect(count).toBe(1);
  });

  it("registers, lists and unregisters world nodes", async () => {
    const transport = new InMemoryFederationTransport();
    expect(await transport.listNodes()).toHaveLength(0);
    await transport.registerNode(node("firenze"));
    await transport.registerNode(node("roma"));
    const nodes = await transport.listNodes();
    expect(nodes.map((n) => n.worldId).sort()).toEqual(["firenze", "roma"]);
    await transport.unregisterNode("firenze");
    expect((await transport.listNodes()).map((n) => n.worldId)).toEqual(["roma"]);
  });

  it("survives a handler that throws", async () => {
    const transport = new InMemoryFederationTransport();
    let received = false;
    await transport.subscribe("roma", async () => {
      throw new Error("boom");
    });
    await transport.subscribe("roma", async () => {
      received = true;
    });
    await expect(transport.publish(envelope("roma"))).rejects.toThrow("boom");
    // The second handler still ran (Promise.all settles all in parallel before reject surfaces).
    expect(received).toBe(true);
  });
});
