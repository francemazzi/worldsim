/**
 * federation-two-cities — Phase 1 demo of cross-world messaging.
 *
 * Two simulated worlds (Firenze, Roma) share a single in-memory federation
 * transport. We tick them manually to show that an SMS sent at tick N of
 * Firenze is delivered at the next tick of Roma — exactly the asynchronous
 * "letter" semantics described in `docs/federation.md`.
 *
 * No LLM, no Redis, no env vars required.
 *
 *   npm run demo:federation
 */

import { MessageBus, createMessageId } from "../../src/messaging/MessageBus.js";
import { PluginRegistry } from "../../src/plugins/PluginRegistry.js";
import { ConsoleLoggerPlugin } from "../../src/plugins/built-in/ConsoleLoggerPlugin.js";
import {
  FederationBus,
  InMemoryFederationTransport,
  type WorldNode,
} from "../../src/federation/index.js";

const transport = new InMemoryFederationTransport();

function makeWorld(node: WorldNode, knownAgents: string[]) {
  const messageBus = new MessageBus();
  const pluginRegistry = new PluginRegistry();
  pluginRegistry.register(ConsoleLoggerPlugin);
  const tick = { current: 0 };
  const known = new Set(knownAgents);
  const federationBus = new FederationBus({
    worldNode: node,
    transport,
    messageBus,
    pluginRegistry,
    getCurrentTick: () => tick.current,
    hasLocalAgent: (id) => known.has(id),
  });
  return { node, messageBus, pluginRegistry, federationBus, tick };
}

async function main(): Promise<void> {
  const firenze = makeWorld(
    {
      worldId: "firenze",
      displayName: "Firenze",
      capabilities: ["messaging"],
      coordinates: { lat: 43.77, lng: 11.25 },
    },
    ["maria"],
  );
  const roma = makeWorld(
    {
      worldId: "roma",
      displayName: "Roma",
      capabilities: ["messaging"],
      coordinates: { lat: 41.9, lng: 12.5 },
    },
    ["luca"],
  );

  await firenze.federationBus.start();
  await roma.federationBus.start();

  console.log("\n=== federation-two-cities demo ===\n");
  console.log("Federation nodes:", (await transport.listNodes()).map((n) => n.worldId));

  // Tick 5 of Firenze: Maria sends an SMS to roma:luca.
  firenze.tick.current = 5;
  firenze.messageBus.newTick(5);
  console.log("\n[firenze t=5] maria → roma:luca \"Ci vediamo per pranzo?\"");
  firenze.messageBus.publish({
    id: createMessageId(),
    from: "maria",
    to: "roma:luca",
    type: "sms",
    content: "Ci vediamo per pranzo?",
    tick: 5,
    metadata: { federationChannel: "sms" },
  });

  // Let microtasks flush so the in-memory transport hands off the envelope.
  await new Promise((r) => setImmediate(r));

  // Roma's next tick: drain inbound, observe Luca's inbox.
  roma.tick.current = 6;
  roma.messageBus.newTick(6);
  await roma.federationBus.drainInbound(6);
  const lucasInbox = roma.messageBus.getMessages("luca", 6);
  console.log(
    `\n[roma   t=6] luca inbox (${lucasInbox.length} msg):`,
    lucasInbox.map((m) => ({ from: m.from, content: m.content })),
  );

  // Roma replies.
  console.log("\n[roma   t=6] luca → firenze:maria \"Sì, alle 13 in trattoria.\"");
  roma.messageBus.publish({
    id: createMessageId(),
    from: "luca",
    to: "firenze:maria",
    type: "sms",
    content: "Sì, alle 13 in trattoria.",
    tick: 6,
    metadata: { federationChannel: "sms" },
  });

  await new Promise((r) => setImmediate(r));

  // Firenze ticks once more and Maria sees the reply.
  firenze.tick.current = 7;
  firenze.messageBus.newTick(7);
  await firenze.federationBus.drainInbound(7);
  const mariasInbox = firenze.messageBus.getMessages("maria", 7);
  console.log(
    `\n[firenze t=7] maria inbox (${mariasInbox.length} msg):`,
    mariasInbox.map((m) => ({ from: m.from, content: m.content })),
  );

  await firenze.federationBus.stop();
  await roma.federationBus.stop();
  console.log("\n=== demo complete ===\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
