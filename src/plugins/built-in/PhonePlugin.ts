import type { WorldSimPlugin, AgentTool } from "../../types/PluginTypes.js";
import type { WorldContext } from "../../types/WorldTypes.js";
import type { AssetStore } from "../../types/AssetTypes.js";
import type { MessageBus } from "../../messaging/MessageBus.js";
import { createMessageId } from "../../messaging/MessageBus.js";
import type { Message } from "../../messaging/Message.js";
import type { ConversationManager } from "../../messaging/ConversationManager.js";
import {
  PhoneDirectory,
  getAgentPhone,
  getPhoneMetadata,
} from "../../messaging/phone/PhoneDirectory.js";

export interface PhonePluginOptions {
  assetStore: AssetStore;
  messageBus: MessageBus;
  conversationManager: ConversationManager;
  /** Hard cap for SMS body length (default: 480 characters, ~3 SMS). */
  maxSmsLength?: number | undefined;
  /** Hard cap for a single spoken line during a call (default: 800 chars). */
  maxCallLineLength?: number | undefined;
}

interface AgentPhoneSnapshot {
  agentId: string;
  phoneNumber: string;
}

async function getAgentPhoneSnapshot(
  store: AssetStore,
  agentId: string,
): Promise<AgentPhoneSnapshot | null> {
  const phone = await getAgentPhone(store, agentId);
  if (!phone) return null;
  const meta = getPhoneMetadata(phone);
  if (!meta) return null;
  return { agentId, phoneNumber: meta.phoneNumber };
}

interface PhoneToolOptions {
  assetStore: AssetStore;
  messageBus: MessageBus;
  conversationManager: ConversationManager;
  directory: PhoneDirectory;
  maxSmsLength: number;
  maxCallLineLength: number;
}

function buildTools(options: PhoneToolOptions): AgentTool[] {
  const { assetStore, messageBus, conversationManager, directory, maxSmsLength, maxCallLineLength } = options;

  return [
    {
      name: "send_sms",
      description:
        "Invia un messaggio di testo (SMS) a un altro agente, usando il suo numero di telefono. Richiede che tu abbia un telefono.",
      inputSchema: {
        type: "object",
        properties: {
          toPhoneNumber: {
            type: "string",
            description: "Numero di telefono del destinatario.",
          },
          body: {
            type: "string",
            description: "Testo del messaggio.",
          },
        },
        required: ["toPhoneNumber", "body"],
      },
      async execute(input: unknown, ctx: WorldContext) {
        const { toPhoneNumber, body } = input as { toPhoneNumber: string; body: string };
        const agentId = (ctx.metadata?.currentAgentId as string) ?? "";
        if (!agentId) return { errore: "Mittente sconosciuto." };

        const sender = await getAgentPhoneSnapshot(assetStore, agentId);
        if (!sender) {
          return { errore: "Non hai un telefono: non puoi inviare SMS." };
        }

        const text = String(body ?? "").trim();
        if (text === "") return { errore: "Il messaggio è vuoto." };
        const truncated = text.length > maxSmsLength ? text.slice(0, maxSmsLength) : text;

        const targetNumber = String(toPhoneNumber ?? "").trim();
        if (targetNumber === sender.phoneNumber) {
          return { errore: "Non puoi inviare un SMS a te stesso." };
        }

        const recipientId = await directory.resolve(targetNumber);
        if (!recipientId) {
          return { errore: `Numero ${targetNumber} non raggiungibile.` };
        }
        if (!(await directory.isReachable(recipientId))) {
          return { errore: `Il destinatario ${targetNumber} non è raggiungibile al momento.` };
        }

        const message: Message = {
          id: createMessageId(),
          from: agentId,
          to: recipientId,
          type: "sms",
          content: truncated,
          tick: ctx.tickCount,
          metadata: {
            channel: "sms",
            fromNumber: sender.phoneNumber,
            toNumber: targetNumber,
          },
        };
        messageBus.publish(message);

        return {
          inviato: true,
          a: recipientId,
          numero: targetNumber,
          testo: truncated,
          ...(truncated.length < text.length ? { nota: "Messaggio troncato." } : {}),
        };
      },
    },

    {
      name: "start_call",
      description:
        "Avvia una chiamata telefonica verso un altro agente. Il destinatario riceverà una notifica e potrà rispondere con 'speak_in_call' o rifiutare con 'hang_up'.",
      inputSchema: {
        type: "object",
        properties: {
          toPhoneNumber: {
            type: "string",
            description: "Numero di telefono da chiamare.",
          },
        },
        required: ["toPhoneNumber"],
      },
      async execute(input: unknown, ctx: WorldContext) {
        const { toPhoneNumber } = input as { toPhoneNumber: string };
        const agentId = (ctx.metadata?.currentAgentId as string) ?? "";
        if (!agentId) return { errore: "Chiamante sconosciuto." };

        const caller = await getAgentPhoneSnapshot(assetStore, agentId);
        if (!caller) return { errore: "Non hai un telefono: non puoi chiamare." };

        const targetNumber = String(toPhoneNumber ?? "").trim();
        if (targetNumber === caller.phoneNumber) {
          return { errore: "Non puoi chiamare te stesso." };
        }

        const calleeId = await directory.resolve(targetNumber);
        if (!calleeId) {
          return { errore: `Numero ${targetNumber} non raggiungibile.` };
        }
        if (!(await directory.isReachable(calleeId))) {
          return { errore: `${targetNumber} non è raggiungibile al momento.` };
        }

        // "Busy" signal: either party is already in an active conversation/call.
        if (conversationManager.getConversationForAgent(agentId)) {
          return { errore: "Sei già in una conversazione: termina prima di chiamare." };
        }
        if (conversationManager.getConversationForAgent(calleeId)) {
          return { errore: `${targetNumber} è occupato (linea impegnata).` };
        }

        const conv = conversationManager.startCall({
          callerId: agentId,
          calleeId,
          callerNumber: caller.phoneNumber,
          calleeNumber: targetNumber,
          tick: ctx.tickCount,
        });
        if (!conv) {
          return { errore: "Impossibile avviare la chiamata." };
        }

        // Notify the callee so they see the incoming call next tick.
        messageBus.publish({
          id: createMessageId(),
          from: agentId,
          to: calleeId,
          type: "call_transcript",
          content: `[chiamata in arrivo da ${caller.phoneNumber}]`,
          tick: ctx.tickCount,
          metadata: {
            channel: "call",
            callId: conv.id,
            fromNumber: caller.phoneNumber,
            toNumber: targetNumber,
            participants: [agentId, calleeId],
            system: true,
          },
        });

        return {
          chiamataAvviata: true,
          callId: conv.id,
          chiamato: calleeId,
          numero: targetNumber,
          nota: "Il destinatario vedrà la chiamata nel prossimo tick. Parla con 'speak_in_call'.",
        };
      },
    },

    {
      name: "speak_in_call",
      description:
        "Pronuncia una frase nella chiamata telefonica in corso. La frase verrà trascritta e inviata all'altro partecipante.",
      inputSchema: {
        type: "object",
        properties: {
          line: {
            type: "string",
            description: "Quello che dici al telefono.",
          },
        },
        required: ["line"],
      },
      async execute(input: unknown, ctx: WorldContext) {
        const { line } = input as { line: string };
        const agentId = (ctx.metadata?.currentAgentId as string) ?? "";
        if (!agentId) return { errore: "Parlante sconosciuto." };

        const conv = conversationManager.getConversationForAgent(agentId);
        if (!conv || conv.metadata?.kind !== "call") {
          return { errore: "Non sei in una chiamata in corso." };
        }

        const canSpeak = conversationManager.canSpeak(agentId);
        if (!canSpeak.allowed) {
          return { errore: `Non è il tuo turno di parlare. ${canSpeak.reason ?? ""}`.trim() };
        }

        const text = String(line ?? "").trim();
        if (text === "") return { errore: "Non hai detto nulla." };
        const truncated = text.length > maxCallLineLength ? text.slice(0, maxCallLineLength) : text;

        const speakerPhone = await getAgentPhoneSnapshot(assetStore, agentId);
        const speakerNumber =
          speakerPhone?.phoneNumber
          ?? (conv.metadata?.callerNumber && conv.initiatorId === agentId
            ? conv.metadata.callerNumber
            : conv.metadata?.calleeNumber);

        const recipients = conv.participantIds.filter((id) => id !== agentId);
        for (const recipientId of recipients) {
          messageBus.publish({
            id: createMessageId(),
            from: agentId,
            to: recipientId,
            type: "call_transcript",
            content: truncated,
            tick: ctx.tickCount,
            metadata: {
              channel: "call",
              callId: conv.id,
              ...(speakerNumber ? { fromNumber: speakerNumber } : {}),
              participants: conv.participantIds,
            },
          });
        }

        conversationManager.advanceTurn(conv.id, agentId, ctx.tickCount);

        return {
          detto: truncated,
          callId: conv.id,
          a: recipients,
          ...(truncated.length < text.length ? { nota: "Frase troncata." } : {}),
        };
      },
    },

    {
      name: "hang_up",
      description:
        "Chiudi la chiamata telefonica in corso (funziona anche come rifiuto di una chiamata in arrivo).",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
      async execute(_input: unknown, ctx: WorldContext) {
        const agentId = (ctx.metadata?.currentAgentId as string) ?? "";
        if (!agentId) return { errore: "Agente sconosciuto." };

        const conv = conversationManager.getConversationForAgent(agentId);
        if (!conv || conv.metadata?.kind !== "call") {
          return { nota: "Non sei in nessuna chiamata." };
        }

        const recipients = conv.participantIds.filter((id) => id !== agentId);
        const callId = conv.id;

        for (const recipientId of recipients) {
          messageBus.publish({
            id: createMessageId(),
            from: agentId,
            to: recipientId,
            type: "call_transcript",
            content: "[chiamata terminata]",
            tick: ctx.tickCount,
            metadata: {
              channel: "call",
              callId,
              participants: conv.participantIds,
              system: true,
            },
          });
        }

        conversationManager.endCall(callId);

        return {
          riattaccato: true,
          callId,
        };
      },
    },
  ];
}

export class PhonePlugin implements WorldSimPlugin {
  readonly name = "phone";
  readonly version = "1.0.0";
  readonly parallel = true;

  private _tools: AgentTool[];
  private readonly directory: PhoneDirectory;

  constructor(options: PhonePluginOptions) {
    this.directory = new PhoneDirectory(options.assetStore);
    this._tools = buildTools({
      assetStore: options.assetStore,
      messageBus: options.messageBus,
      conversationManager: options.conversationManager,
      directory: this.directory,
      maxSmsLength: options.maxSmsLength ?? 480,
      maxCallLineLength: options.maxCallLineLength ?? 800,
    });
  }

  get tools(): AgentTool[] {
    return this._tools;
  }

  /** Read-only access to the phone directory (useful for external lookups/tests). */
  getDirectory(): PhoneDirectory {
    return this.directory;
  }
}
