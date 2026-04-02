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
  private _currentTick = 0;

  get currentTick(): number {
    return this._currentTick;
  }

  newTick(tick: number): void {
    this.tickMessages.delete(this._currentTick);
    this._currentTick = tick;
    this.tickMessages.set(tick, []);
  }

  publish(message: Message): void {
    const msgs = this.tickMessages.get(this._currentTick);
    if (msgs) {
      msgs.push(message);
    } else {
      this.tickMessages.set(this._currentTick, [message]);
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

  getMessages(agentId: string, tick: number): Message[] {
    const msgs = this.tickMessages.get(tick) ?? [];
    return msgs.filter((m) => m.to === agentId || m.to === "*");
  }

  broadcast(message: Omit<Message, "to">): void {
    this.publish({ ...message, to: "*" });
  }

  getAllMessagesForTick(tick: number): Message[] {
    return this.tickMessages.get(tick) ?? [];
  }

  clear(): void {
    this.tickMessages.clear();
    this._currentTick = 0;
    this.emitter.all.clear();
  }
}
