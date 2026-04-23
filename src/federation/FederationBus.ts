import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { MessageBus } from "../messaging/MessageBus.js";
import { createMessageId } from "../messaging/MessageBus.js";
import type { Message, MessageType } from "../messaging/Message.js";
import type { PluginRegistry } from "../plugins/PluginRegistry.js";

import type { FederationTransport } from "./FederationTransport.js";
import type {
  CrossWorldChannel,
  CrossWorldEnvelope,
  Unsubscribe,
  WorldNode,
} from "./types.js";
import { format, parse } from "./FederatedAgentId.js";
import { FederationInboundQueue } from "./FederationInboundQueue.js";
import { crossWorldEnvelopeSchema } from "./schemas.js";

export interface FederationBusOptions {
  worldNode: WorldNode;
  transport: FederationTransport;
  messageBus: MessageBus;
  pluginRegistry: PluginRegistry;
  /** Reads the current local tick. The bus uses it to time outbound envelopes. */
  getCurrentTick: () => number;
  /** Returns true when an agent with that bare id exists locally. */
  hasLocalAgent: (agentId: string) => boolean;
}

/**
 * Bridges the local `MessageBus` with a `FederationTransport`.
 *
 * Outbound: when an agent tool publishes a message addressed to a remote
 * `worldId:agentId`, the `MessageBus` external router (set by `start()`)
 * forwards it here, we serialize an envelope, and hand it to the transport.
 *
 * Inbound: arriving envelopes are buffered in `FederationInboundQueue`. The
 * `TickOrchestrator` calls `drainInbound(tick)` at the start of every tick,
 * which translates each envelope into a local `Message` and publishes it
 * through the bus. Envelopes addressed to unknown agents are dropped with a
 * warning (no crash).
 */
export class FederationBus {
  private readonly inboundQueue = new FederationInboundQueue();
  private unsubscribe: Unsubscribe | undefined;
  private started = false;

  constructor(private readonly options: FederationBusOptions) {}

  get worldNode(): WorldNode {
    return this.options.worldNode;
  }

  get transport(): FederationTransport {
    return this.options.transport;
  }

  inboundSize(): number {
    return this.inboundQueue.size();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.options.transport.registerNode(this.options.worldNode);

    this.unsubscribe = await this.options.transport.subscribe(
      this.options.worldNode.worldId,
      async (envelope: CrossWorldEnvelope) => {
        this.inboundQueue.push(envelope);
      },
    );

    this.options.messageBus.setExternalRouter(
      this.options.worldNode.worldId,
      (msg) => this.handleOutbound(msg),
    );
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    this.options.messageBus.setExternalRouter(
      this.options.worldNode.worldId,
      undefined,
    );

    if (this.unsubscribe) {
      try {
        await this.unsubscribe();
      } catch (err) {
        console.warn("[FederationBus] unsubscribe threw:", err);
      }
      this.unsubscribe = undefined;
    }

    try {
      await this.options.transport.unregisterNode(
        this.options.worldNode.worldId,
      );
    } catch (err) {
      console.warn("[FederationBus] unregisterNode threw:", err);
    }
  }

  /**
   * Drains the inbound queue and injects each envelope into the local bus
   * as a Message. Called by `TickOrchestrator` at the start of each tick.
   */
  async drainInbound(tick: number): Promise<void> {
    const envelopes = this.inboundQueue.drain();
    if (envelopes.length === 0) return;

    for (const envelope of envelopes) {
      const validated = this.validateInbound(envelope);
      if (!validated) continue;

      if (
        validated.toAgentId !== "*"
        && !this.options.hasLocalAgent(validated.toAgentId)
      ) {
        console.warn(
          `[FederationBus] dropping envelope ${validated.id} → ${validated.toWorldId}:${validated.toAgentId} (agent not found)`,
        );
        continue;
      }

      const localMessage = this.envelopeToMessage(validated, tick);
      this.options.messageBus.publish(localMessage);

      await this.options.pluginRegistry.runHook(
        "onCrossWorldMessage",
        validated,
        "inbound",
      );
    }
  }

  private validateInbound(
    envelope: CrossWorldEnvelope,
  ): CrossWorldEnvelope | null {
    try {
      return crossWorldEnvelopeSchema.parse(envelope) as CrossWorldEnvelope;
    } catch (err) {
      const reason =
        err instanceof z.ZodError ? err.issues : (err as Error).message;
      console.warn(
        "[FederationBus] dropping malformed inbound envelope:",
        reason,
      );
      return null;
    }
  }

  private envelopeToMessage(
    envelope: CrossWorldEnvelope,
    tick: number,
  ): Message {
    const senderId = format(envelope.fromWorldId, envelope.fromAgentId);
    const messageType = mapChannelToMessageType(envelope.channel);
    const content = extractStringContent(envelope.payload);

    const meta: Record<string, unknown> = {
      sourceWorld: envelope.fromWorldId,
      federationEnvelopeId: envelope.id,
      federationChannel: envelope.channel,
      payload: envelope.payload,
    };
    if (envelope.correlationId !== undefined) {
      meta.federationCorrelationId = envelope.correlationId;
    }

    return {
      id: createMessageId(),
      from: senderId,
      to: envelope.toAgentId === "*" ? "*" : envelope.toAgentId,
      type: messageType,
      content,
      tick,
      metadata: meta,
    };
  }

  private async handleOutbound(message: Message): Promise<void> {
    if (message.to === "*") return; // local broadcast, never federated

    const parsed = parse(message.to);
    if (!parsed) return;

    const channel = pickOutboundChannel(message);

    const envelope: CrossWorldEnvelope = {
      id: randomUUID(),
      fromWorldId: this.options.worldNode.worldId,
      toWorldId: parsed.worldId,
      fromAgentId: message.from,
      toAgentId: parsed.agentId,
      channel,
      payload: { content: message.content, ...sanitizeOutboundMetadata(message.metadata) },
      sentAtTick: this.options.getCurrentTick(),
      sentAtRealTime: new Date().toISOString(),
      ...(message.metadata?.federationCorrelationId
        ? { correlationId: message.metadata.federationCorrelationId }
        : {}),
    };

    try {
      crossWorldEnvelopeSchema.parse(envelope);
    } catch (err) {
      const reason =
        err instanceof z.ZodError ? err.issues : (err as Error).message;
      console.warn(
        "[FederationBus] outbound envelope failed validation, dropped:",
        reason,
      );
      return;
    }

    try {
      await this.options.transport.publish(envelope);
    } catch (err) {
      console.warn("[FederationBus] transport.publish threw:", err);
      return;
    }

    await this.options.pluginRegistry.runHook(
      "onCrossWorldMessage",
      envelope,
      "outbound",
    );
  }
}

function mapChannelToMessageType(channel: CrossWorldChannel): MessageType {
  switch (channel) {
    case "sms":
    case "email":
      return "sms";
    case "call_request":
    case "system":
      return "system";
    case "call_turn":
      return "call_transcript";
  }
}

function pickOutboundChannel(message: Message): CrossWorldChannel {
  const explicit = message.metadata?.federationChannel;
  if (explicit !== undefined) return explicit;
  switch (message.type) {
    case "sms":
      return "sms";
    case "call_transcript":
      return "call_turn";
    default:
      return "system";
  }
}

function extractStringContent(payload: unknown): string {
  if (
    payload !== null
    && typeof payload === "object"
    && "content" in payload
    && typeof (payload as { content: unknown }).content === "string"
  ) {
    return (payload as { content: string }).content;
  }
  if (typeof payload === "string") return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function sanitizeOutboundMetadata(
  metadata: Message["metadata"],
): { metadata?: Record<string, unknown> } {
  if (!metadata) return {};
  // Strip federation-internal hints — they would be re-derived by the receiver.
  const FEDERATION_KEYS = new Set([
    "federationChannel",
    "federationCorrelationId",
    "sourceWorld",
    "federationEnvelopeId",
  ]);
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!FEDERATION_KEYS.has(k)) rest[k] = v;
  }
  if (Object.keys(rest).length === 0) return {};
  return { metadata: rest };
}
