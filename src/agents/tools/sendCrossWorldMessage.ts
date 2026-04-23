import { z } from "zod";

import type { AgentTool } from "../../types/PluginTypes.js";
import type { WorldContext } from "../../types/WorldTypes.js";
import type { MessageBus } from "../../messaging/MessageBus.js";
import { createMessageId } from "../../messaging/MessageBus.js";
import type { Message, MessageType } from "../../messaging/Message.js";
import { format, isFederatedAgentId } from "../../federation/FederatedAgentId.js";

const inputSchema = z.object({
  targetAgent: z
    .string()
    .min(3)
    .refine((s) => s.includes(":"), {
      message: "targetAgent must look like \"worldId:agentId\"",
    }),
  channel: z.enum(["sms", "email"]),
  content: z.string().min(1).max(2000),
});

export interface SendCrossWorldMessageOptions {
  worldId: string;
  messageBus: MessageBus;
}

const CHANNEL_TO_MESSAGE_TYPE: Record<"sms" | "email", MessageType> = {
  sms: "sms",
  // Until a dedicated "email" MessageType is introduced we surface emails
  // as system messages so existing UI/log code routes them sensibly.
  email: "system",
};

export function createSendCrossWorldMessageTool(
  options: SendCrossWorldMessageOptions,
): AgentTool {
  return {
    name: "send_cross_world_message",
    description:
      "Invia un messaggio (SMS o email) a un agente che vive in un altro world della federazione. Il destinatario deve essere indicato come \"worldId:agentId\" (es. \"roma:luca\"). Il messaggio sarà consegnato al primo tick utile dell'altro world.",
    inputSchema: {
      type: "object",
      properties: {
        targetAgent: {
          type: "string",
          description:
            "Identificatore federato del destinatario, formato \"worldId:agentId\".",
        },
        channel: {
          type: "string",
          enum: ["sms", "email"],
          description: "Canale del messaggio.",
        },
        content: {
          type: "string",
          description: "Testo del messaggio (max 2000 caratteri).",
        },
      },
      required: ["targetAgent", "channel", "content"],
    },
    async execute(input: unknown, ctx: WorldContext) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) {
        return { errore: parsed.error.issues[0]?.message ?? "Input non valido." };
      }
      const { targetAgent, channel, content } = parsed.data;

      const senderAgentId = (ctx.metadata?.currentAgentId as string) ?? "";
      if (!senderAgentId) return { errore: "Mittente sconosciuto." };

      if (!isFederatedAgentId(targetAgent)) {
        return { errore: `\"${targetAgent}\" non è un FederatedAgentId valido.` };
      }
      const senderFederatedId = format(options.worldId, senderAgentId);
      if (targetAgent === senderFederatedId) {
        return { errore: "Non puoi inviarti un messaggio cross-world." };
      }

      const message: Message = {
        id: createMessageId(),
        from: senderAgentId,
        to: targetAgent,
        type: CHANNEL_TO_MESSAGE_TYPE[channel],
        content,
        tick: ctx.tickCount,
        metadata: {
          federationChannel: channel,
        },
      };

      // MessageBus delegates to the FederationBus when `to` is external.
      options.messageBus.publish(message);

      return {
        inviato: true,
        a: targetAgent,
        canale: channel,
        nota: "Il messaggio sarà consegnato al primo tick utile del world destinatario.",
      };
    },
  };
}
