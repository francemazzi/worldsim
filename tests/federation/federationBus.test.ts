import { describe, expect, it, vi } from "vitest";
import { MessageBus, createMessageId } from "../../src/messaging/MessageBus.js";
import type { Message } from "../../src/messaging/Message.js";
import { PluginRegistry } from "../../src/plugins/PluginRegistry.js";
import { FederationBus } from "../../src/federation/FederationBus.js";
import { InMemoryFederationTransport } from "../../src/federation/InMemoryFederationTransport.js";
import type {
  CrossWorldEnvelope,
  WorldNode,
} from "../../src/federation/types.js";

const node = (worldId: string): WorldNode => ({
  worldId,
  displayName: worldId,
  capabilities: ["messaging"],
});

interface BusFixture {
  bus: MessageBus;
  fed: FederationBus;
  transport: InMemoryFederationTransport;
  plugins: PluginRegistry;
  tick: { current: number };
  knownAgents: Set<string>;
}

async function setupBus(
  worldId: string,
  options: {
    transport?: InMemoryFederationTransport;
    knownAgents?: string[];
  } = {},
): Promise<BusFixture> {
  const transport = options.transport ?? new InMemoryFederationTransport();
  const bus = new MessageBus();
  const plugins = new PluginRegistry();
  const tick = { current: 0 };
  const knownAgents = new Set(options.knownAgents ?? []);
  const fed = new FederationBus({
    worldNode: node(worldId),
    transport,
    messageBus: bus,
    pluginRegistry: plugins,
    getCurrentTick: () => tick.current,
    hasLocalAgent: (id) => knownAgents.has(id),
  });
  await fed.start();
  return { bus, fed, transport, plugins, tick, knownAgents };
}

describe("FederationBus", () => {
  it("registers the world node and subscribes on start()", async () => {
    const transport = new InMemoryFederationTransport();
    const fixture = await setupBus("firenze", { transport });
    const nodes = await transport.listNodes();
    expect(nodes.map((n) => n.worldId)).toEqual(["firenze"]);
    await fixture.fed.stop();
    expect(await transport.listNodes()).toHaveLength(0);
  });

  it("converts an outbound publish into an envelope on the transport", async () => {
    const transport = new InMemoryFederationTransport();
    const received: CrossWorldEnvelope[] = [];
    await transport.subscribe("roma", async (env) => { received.push(env); });
    const fixture = await setupBus("firenze", { transport });

    fixture.tick.current = 5;
    fixture.bus.newTick(5);
    fixture.bus.publish({
      id: createMessageId(),
      from: "maria",
      to: "roma:luca",
      type: "sms",
      content: "ci vediamo",
      tick: 5,
      metadata: { federationChannel: "sms" },
    });

    // External router is fire-and-forget; flush microtasks.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(received).toHaveLength(1);
    const env = received[0]!;
    expect(env.fromWorldId).toBe("firenze");
    expect(env.toWorldId).toBe("roma");
    expect(env.fromAgentId).toBe("maria");
    expect(env.toAgentId).toBe("luca");
    expect(env.channel).toBe("sms");
    expect(env.sentAtTick).toBe(5);
    expect((env.payload as { content: string }).content).toBe("ci vediamo");

    await fixture.fed.stop();
  });

  it("queues inbound envelopes and publishes them on drainInbound()", async () => {
    const transport = new InMemoryFederationTransport();
    const firenze = await setupBus("firenze", { transport });
    const roma = await setupBus("roma", {
      transport,
      knownAgents: ["luca"],
    });

    firenze.tick.current = 5;
    firenze.bus.newTick(5);
    firenze.bus.publish({
      id: createMessageId(),
      from: "maria",
      to: "roma:luca",
      type: "sms",
      content: "saluti",
      tick: 5,
      metadata: { federationChannel: "sms" },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(roma.fed.inboundSize()).toBe(1);

    roma.tick.current = 6;
    roma.bus.newTick(6);
    await roma.fed.drainInbound(6);

    const delivered = roma.bus.getMessages("luca", 6);
    expect(delivered).toHaveLength(1);
    const m = delivered[0]!;
    expect(m.to).toBe("luca");
    expect(m.from).toBe("firenze:maria");
    expect(m.content).toBe("saluti");
    expect(m.metadata?.sourceWorld).toBe("firenze");
    expect(m.metadata?.federationEnvelopeId).toBeTruthy();

    await firenze.fed.stop();
    await roma.fed.stop();
  });

  it("drops inbound envelopes addressed to unknown local agents (no crash)", async () => {
    const transport = new InMemoryFederationTransport();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const firenze = await setupBus("firenze", { transport });
    const roma = await setupBus("roma", { transport, knownAgents: [] });

    firenze.tick.current = 1;
    firenze.bus.newTick(1);
    firenze.bus.publish({
      id: createMessageId(),
      from: "maria",
      to: "roma:fantasma",
      type: "sms",
      content: "?",
      tick: 1,
      metadata: { federationChannel: "sms" },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    roma.tick.current = 2;
    roma.bus.newTick(2);
    await roma.fed.drainInbound(2);

    expect(roma.bus.getAllMessagesForTick(2)).toHaveLength(0);
    expect(consoleWarn).toHaveBeenCalled();

    consoleWarn.mockRestore();
    await firenze.fed.stop();
    await roma.fed.stop();
  });

  it("invokes the onCrossWorldMessage hook for both directions", async () => {
    const transport = new InMemoryFederationTransport();
    const firenze = await setupBus("firenze", { transport });
    const roma = await setupBus("roma", {
      transport,
      knownAgents: ["luca"],
    });

    const events: Array<{ direction: string; envId: string }> = [];
    const observer = {
      name: "observer",
      version: "1.0.0",
      async onCrossWorldMessage(envelope: CrossWorldEnvelope, direction: "inbound" | "outbound") {
        events.push({ direction, envId: envelope.id });
      },
    };
    firenze.plugins.register(observer);
    roma.plugins.register({ ...observer, name: "observer" });

    firenze.tick.current = 1;
    firenze.bus.newTick(1);
    firenze.bus.publish({
      id: createMessageId(),
      from: "maria",
      to: "roma:luca",
      type: "sms",
      content: "ping",
      tick: 1,
      metadata: { federationChannel: "sms" },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    roma.tick.current = 2;
    roma.bus.newTick(2);
    await roma.fed.drainInbound(2);

    const directions = events.map((e) => e.direction).sort();
    expect(directions).toEqual(["inbound", "outbound"]);

    await firenze.fed.stop();
    await roma.fed.stop();
  });

  it("does not delegate broadcast (to: '*') to the transport", async () => {
    const transport = new InMemoryFederationTransport();
    const sent: CrossWorldEnvelope[] = [];
    await transport.subscribe("roma", async (env) => { sent.push(env); });
    const fixture = await setupBus("firenze", { transport });

    fixture.bus.newTick(1);
    fixture.bus.publish({
      id: createMessageId(),
      from: "maria",
      to: "*",
      type: "sms",
      content: "annuncio",
      tick: 1,
    });
    await Promise.resolve();

    expect(sent).toHaveLength(0);
    await fixture.fed.stop();
  });
});

describe("FederationBus end-to-end (two engines, in-memory transport)", () => {
  it("delivers a cross-world message at the next tick of the receiver", async () => {
    const transport = new InMemoryFederationTransport();
    const firenze = await setupBus("firenze", { transport });
    const roma = await setupBus("roma", {
      transport,
      knownAgents: ["luca"],
    });

    // tick 5 of firenze: maria sends sms to roma:luca
    firenze.tick.current = 5;
    firenze.bus.newTick(5);
    firenze.bus.publish({
      id: createMessageId(),
      from: "maria",
      to: "roma:luca",
      type: "sms",
      content: "ci vediamo",
      tick: 5,
      metadata: { federationChannel: "sms" },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // roma is at tick 0; the next tick (6) should deliver
    roma.tick.current = 6;
    roma.bus.newTick(6);
    await roma.fed.drainInbound(6);

    const inbox = roma.bus.getMessages("luca", 6);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]?.content).toBe("ci vediamo");

    await firenze.fed.stop();
    await roma.fed.stop();
  });
});
