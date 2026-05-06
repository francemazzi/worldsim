import mitt, { type Emitter } from "mitt";
import type { Message } from "./Message.js";
import {
  isExternal,
  stripLocalPrefix,
} from "../federation/FederatedAgentId.js";
import {
  compareTimelineMetadata,
  IntraTickTimeline,
} from "../engine/IntraTickTimeline.js";
import type { TimelineMetadata } from "../types/TimelineTypes.js";

type BusEvents = {
  message: Message;
};

let messageIdCounter = 0;

export function createMessageId(): string {
  messageIdCounter += 1;
  return `msg-${Date.now()}-${messageIdCounter}`;
}

export type ExternalRouter = (message: Message) => void | Promise<void>;

export class MessageBus {
  private emitter: Emitter<BusEvents> = mitt<BusEvents>();
  private tickMessages: Map<number, Message[]> = new Map();
  private recipientIndex: Map<number, Map<string, Message[]>> = new Map();
  private broadcastMessages: Map<number, Message[]> = new Map();
  private _currentTick = 0;
  private externalRouter:
    | { localWorldId: string; handler: ExternalRouter }
    | undefined;

  constructor(private readonly timeline: IntraTickTimeline = new IntraTickTimeline()) {}

  /**
   * Wires the bus to a federation transport. When a published message has a
   * `to` of the form `worldId:agentId` and that `worldId` is not the local one,
   * the message is handed to `handler` instead of being delivered locally.
   * Local-prefixed addresses (`localWorldId:agentId`) are stripped to the bare
   * agent id before being dispatched normally.
   *
   * Calling this twice replaces the previous router. Pass `undefined` to detach.
   */
  setExternalRouter(
    localWorldId: string,
    handler: ExternalRouter | undefined,
  ): void {
    if (handler === undefined) {
      this.externalRouter = undefined;
      return;
    }
    this.externalRouter = { localWorldId, handler };
  }

  get currentTick(): number {
    return this._currentTick;
  }

  newTick(tick: number): void {
    this.tickMessages.delete(this._currentTick);
    this.recipientIndex.delete(this._currentTick);
    this.broadcastMessages.delete(this._currentTick);
    this._currentTick = tick;
    this.timeline.reset(tick);
    this.tickMessages.set(tick, []);
    this.recipientIndex.set(tick, new Map());
    this.broadcastMessages.set(tick, []);
  }

  publish(message: Message): void {
    // Federation routing — only when an external router is configured AND
    // the destination is a federated id whose world is not the local one.
    if (this.externalRouter && message.to !== "*") {
      const router = this.externalRouter;
      if (isExternal(message.to, router.localWorldId)) {
        // Fire-and-forget: the FederationBus is responsible for awaiting its
        // own transport and reporting errors. We do not block the publisher.
        try {
          void Promise.resolve(router.handler(message)).catch(
            (err: unknown) => {
              console.warn("[MessageBus] external router threw:", err);
            },
          );
        } catch (err) {
          console.warn("[MessageBus] external router threw:", err);
        }
        return;
      }
      // Local-prefixed address → strip to the bare local agent id.
      const localTo = stripLocalPrefix(message.to, router.localWorldId);
      if (localTo !== message.to) {
        message = { ...message, to: localTo };
      }
    }

    message = this.ensureTimelineMetadata(message);

    const msgs = this.tickMessages.get(this._currentTick);
    if (msgs) {
      msgs.push(message);
    } else {
      this.tickMessages.set(this._currentTick, [message]);
    }

    // Maintain secondary indexes
    if (message.to === "*") {
      const bcasts = this.broadcastMessages.get(this._currentTick);
      if (bcasts) {
        bcasts.push(message);
      } else {
        this.broadcastMessages.set(this._currentTick, [message]);
      }
    } else {
      const tickIdx = this.recipientIndex.get(this._currentTick);
      if (tickIdx) {
        const arr = tickIdx.get(message.to);
        if (arr) {
          arr.push(message);
        } else {
          tickIdx.set(message.to, [message]);
        }
      }
    }

    this.emitter.emit("message", message);
  }

  subscribe(
    agentId: string,
    handler: (msg: Message) => void,
  ): () => void {
    const wrappedHandler = (msg: Message): void => {
      if (msg.to === agentId || msg.to === "*") {
        handler(msg);
      }
    };
    this.emitter.on("message", wrappedHandler);
    return () => this.emitter.off("message", wrappedHandler);
  }

  /**
   * Returns messages for a specific agent on a given tick.
   * O(1) lookup via recipient index + broadcast merge.
   */
  getMessages(agentId: string, tick: number): Message[] {
    const directed = this.recipientIndex.get(tick)?.get(agentId) ?? [];
    const broadcasts = this.broadcastMessages.get(tick) ?? [];
    if (directed.length === 0) return sortMessagesByTimeline(broadcasts);
    if (broadcasts.length === 0) return sortMessagesByTimeline(directed);
    return sortMessagesByTimeline([...directed, ...broadcasts]);
  }

  /**
   * Returns message count for a specific agent on a given tick.
   * O(1) without materializing arrays.
   */
  getMessageCount(agentId: string, tick: number): number {
    const directedCount = this.recipientIndex.get(tick)?.get(agentId)?.length ?? 0;
    const broadcastCount = this.broadcastMessages.get(tick)?.length ?? 0;
    return directedCount + broadcastCount;
  }

  broadcast(message: Omit<Message, "to">): void {
    this.publish({ ...message, to: "*" });
  }

  /**
   * Publishes a message to a specific set of recipients.
   * Creates one message per recipient with the same content.
   */
  publishToGroup(message: Omit<Message, "to">, recipientIds: string[]): void {
    for (const recipientId of recipientIds) {
      this.publish({ ...message, to: recipientId });
    }
  }

  getAllMessagesForTick(tick: number): Message[] {
    return sortMessagesByTimeline(this.tickMessages.get(tick) ?? []);
  }

  clear(): void {
    this.tickMessages.clear();
    this.recipientIndex.clear();
    this.broadcastMessages.clear();
    this._currentTick = 0;
    this.emitter.all.clear();
  }

  private ensureTimelineMetadata(message: Message): Message {
    const metadata = message.metadata as TimelineMetadata | undefined;
    if (typeof metadata?.tickSequence === "number" && typeof metadata.simulatedAtOffsetMs === "number") {
      return message;
    }

    const stamp = this.timeline.nextEvent();
    return {
      ...message,
      metadata: {
        ...(message.metadata ?? {}),
        ...stamp,
        actionAtOffsetMs: stamp.simulatedAtOffsetMs,
      },
    };
  }
}

export function sortMessagesByTimeline(messages: Message[]): Message[] {
  return [...messages].sort((a, b) => {
    const temporal = compareTimelineMetadata(a.metadata, b.metadata);
    if (temporal !== 0) return temporal;
    return a.id.localeCompare(b.id);
  });
}
