import mitt, { type Emitter } from "mitt";
import type { Message } from "./Message.js";

type BusEvents = {
  message: Message;
};

let messageIdCounter = 0;

export function createMessageId(): string {
  messageIdCounter += 1;
  return `msg-${Date.now()}-${messageIdCounter}`;
}

export class MessageBus {
  private emitter: Emitter<BusEvents> = mitt<BusEvents>();
  private tickMessages: Map<number, Message[]> = new Map();
  private recipientIndex: Map<number, Map<string, Message[]>> = new Map();
  private broadcastMessages: Map<number, Message[]> = new Map();
  private _currentTick = 0;

  get currentTick(): number {
    return this._currentTick;
  }

  newTick(tick: number): void {
    this.tickMessages.delete(this._currentTick);
    this.recipientIndex.delete(this._currentTick);
    this.broadcastMessages.delete(this._currentTick);
    this._currentTick = tick;
    this.tickMessages.set(tick, []);
    this.recipientIndex.set(tick, new Map());
    this.broadcastMessages.set(tick, []);
  }

  publish(message: Message): void {
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
    if (directed.length === 0) return broadcasts;
    if (broadcasts.length === 0) return directed;
    return [...directed, ...broadcasts];
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
    return this.tickMessages.get(tick) ?? [];
  }

  clear(): void {
    this.tickMessages.clear();
    this.recipientIndex.clear();
    this.broadcastMessages.clear();
    this._currentTick = 0;
    this.emitter.all.clear();
  }
}
