import { describe, it, expect, beforeEach } from "vitest";
import { PhonePlugin } from "../../src/plugins/built-in/PhonePlugin.js";
import { InMemoryAssetStore } from "../../src/stores/InMemoryAssetStore.js";
import { MessageBus } from "../../src/messaging/MessageBus.js";
import { ConversationManager } from "../../src/messaging/ConversationManager.js";
import { createPhoneAsset } from "../../src/messaging/phone/PhoneDirectory.js";
import type { AgentTool } from "../../src/types/PluginTypes.js";
import type { WorldContext } from "../../src/types/WorldTypes.js";

function makeCtx(agentId: string, tick: number): WorldContext {
  return {
    worldId: "test",
    tickCount: tick,
    startedAt: new Date(),
    metadata: { currentAgentId: agentId },
  };
}

function findTool(tools: AgentTool[], name: string): AgentTool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool '${name}' not found`);
  return t;
}

describe("PhonePlugin", () => {
  let store: InMemoryAssetStore;
  let bus: MessageBus;
  let cm: ConversationManager;
  let plugin: PhonePlugin;
  let tools: AgentTool[];

  beforeEach(async () => {
    store = new InMemoryAssetStore();
    bus = new MessageBus();
    cm = new ConversationManager();
    bus.newTick(1);

    await store.addAssets([
      createPhoneAsset({ agentId: "alice", phoneNumber: "+39 111" }),
      createPhoneAsset({ agentId: "bob", phoneNumber: "+39 222" }),
    ]);

    plugin = new PhonePlugin({ assetStore: store, messageBus: bus, conversationManager: cm });
    tools = plugin.tools;
  });

  describe("send_sms", () => {
    it("delivers an SMS as a directed message on the bus", async () => {
      const tool = findTool(tools, "send_sms");
      const result = (await tool.execute(
        { toPhoneNumber: "+39 222", body: "ciao Bob" },
        makeCtx("alice", 1),
      )) as { inviato: boolean; a: string };

      expect(result.inviato).toBe(true);
      expect(result.a).toBe("bob");

      const received = bus.getMessages("bob", 1);
      expect(received).toHaveLength(1);
      expect(received[0]?.type).toBe("sms");
      expect(received[0]?.content).toBe("ciao Bob");
      expect(received[0]?.metadata?.fromNumber).toBe("+39 111");
      expect(received[0]?.metadata?.channel).toBe("sms");
    });

    it("fails when the sender has no phone", async () => {
      const tool = findTool(tools, "send_sms");
      const result = (await tool.execute(
        { toPhoneNumber: "+39 222", body: "hello" },
        makeCtx("charlie", 1),
      )) as { errore?: string };

      expect(result.errore).toBeDefined();
      expect(bus.getMessages("bob", 1)).toHaveLength(0);
    });

    it("fails when the recipient number is unknown", async () => {
      const tool = findTool(tools, "send_sms");
      const result = (await tool.execute(
        { toPhoneNumber: "+39 999", body: "hi" },
        makeCtx("alice", 1),
      )) as { errore?: string };

      expect(result.errore).toMatch(/non raggiungibile/i);
    });

    it("rejects an empty body", async () => {
      const tool = findTool(tools, "send_sms");
      const result = (await tool.execute(
        { toPhoneNumber: "+39 222", body: "   " },
        makeCtx("alice", 1),
      )) as { errore?: string };

      expect(result.errore).toBeDefined();
    });
  });

  describe("calls", () => {
    it("start_call + speak_in_call + hang_up produce call_transcript messages with a shared callId", async () => {
      const start = findTool(tools, "start_call");
      const speak = findTool(tools, "speak_in_call");
      const hangup = findTool(tools, "hang_up");

      const startRes = (await start.execute(
        { toPhoneNumber: "+39 222" },
        makeCtx("alice", 1),
      )) as { chiamataAvviata: boolean; callId: string };
      expect(startRes.chiamataAvviata).toBe(true);
      expect(typeof startRes.callId).toBe("string");

      // Bob should see the incoming call notice
      const incoming = bus.getMessages("bob", 1);
      expect(incoming).toHaveLength(1);
      expect(incoming[0]?.type).toBe("call_transcript");
      expect(incoming[0]?.metadata?.callId).toBe(startRes.callId);
      expect(incoming[0]?.metadata?.system).toBe(true);

      // Alice speaks first (she is the initiator)
      bus.newTick(2);
      const speakRes = (await speak.execute(
        { line: "pronto?" },
        makeCtx("alice", 2),
      )) as { detto: string; callId: string };
      expect(speakRes.detto).toBe("pronto?");
      expect(speakRes.callId).toBe(startRes.callId);

      const bobTick2 = bus.getMessages("bob", 2);
      expect(bobTick2).toHaveLength(1);
      expect(bobTick2[0]?.content).toBe("pronto?");
      expect(bobTick2[0]?.metadata?.callId).toBe(startRes.callId);

      // Bob cannot speak out of turn — wait, advance made it his turn.
      const bobSpeakRes = (await speak.execute(
        { line: "ciao" },
        makeCtx("bob", 2),
      )) as { detto: string };
      expect(bobSpeakRes.detto).toBe("ciao");

      // Alice hangs up
      bus.newTick(3);
      const hangRes = (await hangup.execute({}, makeCtx("alice", 3))) as {
        riattaccato: boolean;
        callId: string;
      };
      expect(hangRes.riattaccato).toBe(true);
      expect(hangRes.callId).toBe(startRes.callId);

      const closing = bus.getMessages("bob", 3);
      expect(closing).toHaveLength(1);
      expect(closing[0]?.content).toBe("[chiamata terminata]");

      // Both parties are freed
      expect(cm.canSpeak("alice").allowed).toBe(true);
      expect(cm.canSpeak("bob").allowed).toBe(true);
    });

    it("start_call fails when callee is busy", async () => {
      const start = findTool(tools, "start_call");
      // Pre-busy Bob
      cm.startConversation("bob", ["charlie"]);

      const res = (await start.execute(
        { toPhoneNumber: "+39 222" },
        makeCtx("alice", 1),
      )) as { errore?: string };
      expect(res.errore).toMatch(/occupato|impegnata/i);
    });

    it("speak_in_call respects turn-taking", async () => {
      const start = findTool(tools, "start_call");
      const speak = findTool(tools, "speak_in_call");

      await start.execute({ toPhoneNumber: "+39 222" }, makeCtx("alice", 1));

      // Bob tries to speak before Alice — blocked
      const res = (await speak.execute(
        { line: "senza aspettare" },
        makeCtx("bob", 1),
      )) as { errore?: string };
      expect(res.errore).toMatch(/turno/i);
    });

    it("hang_up returns a note when not in a call", async () => {
      const hangup = findTool(tools, "hang_up");
      const res = (await hangup.execute({}, makeCtx("alice", 1))) as { nota?: string };
      expect(res.nota).toBeDefined();
    });
  });
});
