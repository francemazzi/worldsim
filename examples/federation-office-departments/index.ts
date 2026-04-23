/**
 * federation-office-departments — Phase 1 demo of single-building federation.
 *
 * Two "worlds" inside the same company — Risorse Umane (HR) and
 * Amministrazione — share a single in-memory federation transport. The two
 * departments tick at different rates (HR is faster) and exchange messages
 * about a vacation request, just like a multi-city scenario, but with
 * `estimatedTicks: 0`-style adjacency: every message is delivered at the
 * destination's *very next* tick.
 *
 * Scenario:
 *   t=2  HR   maria      → admin:luca       (sms)    "Approvazione ferie?"
 *   t=4  ADM  luca       ← hr:maria         (inbound, drained at admin's next tick)
 *   t=4  ADM  luca       → hr:maria         (sms)    "Verifico budget."
 *   t=4  ADM  luca       → hr:capo          (email)  "Richiesta da maria, ok?"
 *   t=5  HR   maria      ← admin:luca       (inbound)
 *   t=5  HR   capo       ← admin:luca       (inbound, same tick — both arrived)
 *   t=6  HR   capo       → admin:luca       (sms)    "Approvato."
 *   t=7  ADM  luca       ← hr:capo          (inbound)
 *
 * No LLM, no Redis, no env vars required.
 *
 *   npx tsx examples/federation-office-departments/index.ts
 */

import { MessageBus, createMessageId } from "../../src/messaging/MessageBus.js";
import { PluginRegistry } from "../../src/plugins/PluginRegistry.js";
import {
  FederationBus,
  InMemoryFederationTransport,
  type WorldNode,
} from "../../src/federation/index.js";
import type { CrossWorldEnvelope } from "../../src/federation/index.js";

const transport = new InMemoryFederationTransport();

interface Office {
  node: WorldNode;
  bus: MessageBus;
  fed: FederationBus;
  tick: { current: number };
  agents: Set<string>;
}

const log: string[] = [];
function record(line: string): void {
  log.push(line);
  console.log(line);
}

function makeOffice(
  node: WorldNode,
  agents: string[],
): Office {
  const bus = new MessageBus();
  const plugins = new PluginRegistry();
  const tick = { current: 0 };
  const agentSet = new Set(agents);

  // Audit plugin: prints every cross-world message in/out of this office.
  plugins.register({
    name: "office-audit",
    version: "1.0.0",
    async onCrossWorldMessage(envelope: CrossWorldEnvelope, direction) {
      const localTag = node.displayName.padEnd(16);
      const peer =
        direction === "outbound"
          ? `${envelope.toWorldId}:${envelope.toAgentId}`
          : `${envelope.fromWorldId}:${envelope.fromAgentId}`;
      const localAgent =
        direction === "outbound" ? envelope.fromAgentId : envelope.toAgentId;
      const arrow = direction === "outbound" ? "→" : "←";
      const channel = `(${envelope.channel})`.padEnd(8);
      record(
        `  [${localTag}] ${localAgent.padEnd(8)} ${arrow} ${peer.padEnd(20)} ${channel}`,
      );
    },
  });

  const fed = new FederationBus({
    worldNode: node,
    transport,
    messageBus: bus,
    pluginRegistry: plugins,
    getCurrentTick: () => tick.current,
    hasLocalAgent: (id) => agentSet.has(id),
  });

  return { node, bus, fed, tick, agents: agentSet };
}

async function tickOffice(office: Office, t: number): Promise<void> {
  office.tick.current = t;
  office.bus.newTick(t);
  await office.fed.drainInbound(t);
}

function send(
  office: Office,
  from: string,
  to: string,
  channel: "sms" | "email",
  content: string,
): void {
  office.bus.publish({
    id: createMessageId(),
    from,
    to,
    type: channel === "sms" ? "sms" : "system",
    content,
    tick: office.tick.current,
    metadata: { federationChannel: channel },
  });
}

function dumpInbox(office: Office, agentId: string, t: number): void {
  const inbox = office.bus.getMessages(agentId, t);
  if (inbox.length === 0) return;
  for (const m of inbox) {
    record(
      `  [${office.node.displayName.padEnd(16)}]   inbox(${agentId}) ← ${m.from}: "${m.content}"`,
    );
  }
}

// Wait long enough for the in-memory transport (Promise-based) to flush
// queued envelopes into the receiving office's inbound queue.
async function flushTransport(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
}

async function main(): Promise<void> {
  const hr = makeOffice(
    {
      worldId: "hr",
      displayName: "Risorse Umane",
      capabilities: ["messaging"],
    },
    ["maria", "capo"],
  );
  const admin = makeOffice(
    {
      worldId: "admin",
      displayName: "Amministrazione",
      capabilities: ["messaging"],
    },
    ["luca"],
  );

  await hr.fed.start();
  await admin.fed.start();

  record("\n=== federation-office-departments demo ===\n");
  record(
    `Federation nodes: ${(await transport.listNodes()).map((n) => n.worldId).join(", ")}\n`,
  );

  // -----------------------------------------------------------
  // t=2 (HR ticks): maria asks luca in admin to approve her vacation.
  // -----------------------------------------------------------
  await tickOffice(hr, 2);
  record("HR  t=2");
  send(
    hr,
    "maria",
    "admin:luca",
    "sms",
    "Posso prendere ferie 5-12 maggio? Mi serve la tua approvazione.",
  );
  await flushTransport();

  // -----------------------------------------------------------
  // t=4 (Admin ticks for the first time — async, slower clock):
  // luca reads maria's message and replies that he'll check the budget.
  // -----------------------------------------------------------
  record("\nADM t=4 (drain inbound + reply)");
  await tickOffice(admin, 4);
  dumpInbox(admin, "luca", 4);
  send(
    admin,
    "luca",
    "hr:maria",
    "sms",
    "Verifico budget e ti rispondo entro fine giornata.",
  );
  // Luca also escalates to HR boss for sign-off via email.
  send(
    admin,
    "luca",
    "hr:capo",
    "email",
    "Richiesta ferie maria 5-12 maggio. Budget OK da parte mia. Approvi?",
  );
  await flushTransport();

  // -----------------------------------------------------------
  // t=5 (HR ticks): both maria and capo see their messages from luca —
  // they arrived in the same drainInbound() because admin published both
  // at the same Admin tick.
  // -----------------------------------------------------------
  record("\nHR  t=5 (drain inbound — both maria and capo)");
  await tickOffice(hr, 5);
  dumpInbox(hr, "maria", 5);
  dumpInbox(hr, "capo", 5);

  // -----------------------------------------------------------
  // t=6 (HR ticks again): capo approves.
  // -----------------------------------------------------------
  record("\nHR  t=6 (capo approves)");
  await tickOffice(hr, 6);
  send(
    hr,
    "capo",
    "admin:luca",
    "sms",
    "Approvato. Aggiornare il sistema ferie e avvisare il team.",
  );
  await flushTransport();

  // -----------------------------------------------------------
  // t=7 (Admin ticks): luca sees the approval.
  // -----------------------------------------------------------
  record("\nADM t=7 (drain inbound)");
  await tickOffice(admin, 7);
  dumpInbox(admin, "luca", 7);

  await hr.fed.stop();
  await admin.fed.stop();

  // Quick correctness check (acts as the integration assertion).
  const mariaGotReply = log.some((l) =>
    l.includes("inbox(maria) ← admin:luca"),
  );
  const capoGotEmail = log.some((l) => l.includes("inbox(capo) ← admin:luca"));
  const lucaGotRequest = log.some((l) =>
    l.includes("inbox(luca) ← hr:maria"),
  );
  const lucaGotApproval = log.some((l) =>
    l.includes("inbox(luca) ← hr:capo"),
  );

  record("\n=== integrity checks ===");
  record(`  maria received luca's reply  : ${mariaGotReply ? "OK" : "FAIL"}`);
  record(`  capo  received luca's email  : ${capoGotEmail ? "OK" : "FAIL"}`);
  record(`  luca  received maria request : ${lucaGotRequest ? "OK" : "FAIL"}`);
  record(`  luca  received capo approval : ${lucaGotApproval ? "OK" : "FAIL"}`);

  const ok =
    mariaGotReply && capoGotEmail && lucaGotRequest && lucaGotApproval;
  record(`\n=== demo ${ok ? "PASSED" : "FAILED"} ===\n`);
  if (!ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
