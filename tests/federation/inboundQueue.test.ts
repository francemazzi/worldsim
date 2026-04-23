import { describe, expect, it } from "vitest";
import { FederationInboundQueue } from "../../src/federation/FederationInboundQueue.js";
import type { CrossWorldEnvelope } from "../../src/federation/types.js";

function env(id: string): CrossWorldEnvelope {
  return {
    id,
    fromWorldId: "firenze",
    toWorldId: "roma",
    fromAgentId: "maria",
    toAgentId: "luca",
    channel: "sms",
    payload: { content: "ciao" },
    sentAtTick: 1,
    sentAtRealTime: "2026-04-24T00:00:00.000Z",
  };
}

describe("FederationInboundQueue", () => {
  it("buffers in FIFO order and drains all at once", () => {
    const q = new FederationInboundQueue();
    q.push(env("a"));
    q.push(env("b"));
    q.push(env("c"));
    expect(q.size()).toBe(3);
    const drained = q.drain();
    expect(drained.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(q.size()).toBe(0);
  });

  it("drain on empty queue returns []", () => {
    const q = new FederationInboundQueue();
    expect(q.drain()).toEqual([]);
  });

  it("subsequent pushes are independent of prior drains", () => {
    const q = new FederationInboundQueue();
    q.push(env("a"));
    q.drain();
    q.push(env("b"));
    expect(q.drain().map((e) => e.id)).toEqual(["b"]);
  });
});
