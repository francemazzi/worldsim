import { describe, it, expect, vi } from "vitest";
import { MessageBus, createMessageId } from "../../src/messaging/MessageBus.js";
import type { Message } from "../../src/messaging/Message.js";

function makeMsg(overrides: Partial<Message> = {}): Message {
  return {
    id: createMessageId(),
    from: "agent-a",
    to: "agent-b",
    type: "speak",
    content: "hello",
    tick: 1,
    ...overrides,
  };
}

describe("MessageBus", () => {
  it("newTick() clears messages from the previous tick", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    bus.publish(makeMsg({ to: "agent-b", tick: 1 }));
    expect(bus.getMessages("agent-b", 1)).toHaveLength(1);

    bus.newTick(2);
    expect(bus.getMessages("agent-b", 1)).toHaveLength(0);
    expect(bus.getMessages("agent-b", 2)).toHaveLength(0);
  });

  it("publish() + getMessages() work for the current tick", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    bus.publish(makeMsg({ to: "agent-b", tick: 1 }));
    bus.publish(makeMsg({ to: "agent-c", tick: 1 }));
    bus.publish(makeMsg({ to: "agent-b", tick: 1, content: "second" }));

    const msgs = bus.getMessages("agent-b", 1);
    expect(msgs).toHaveLength(2);
  });

  it("getMessages('world-engine', tick) returns control messages", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    bus.publish(makeMsg({ to: "world-engine", type: "system", tick: 1 }));
    bus.publish(makeMsg({ to: "agent-b", tick: 1 }));

    const ctrl = bus.getMessages("world-engine", 1);
    expect(ctrl).toHaveLength(1);
    expect(ctrl[0]!.type).toBe("system");
  });

  it("broadcast() is received by all subscribers", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    bus.subscribe("agent-a", handlerA);
    bus.subscribe("agent-b", handlerB);

    bus.broadcast({
      id: createMessageId(),
      from: "narrator",
      type: "observe",
      content: "event happened",
      tick: 1,
    });

    expect(handlerA).toHaveBeenCalledOnce();
    expect(handlerB).toHaveBeenCalledOnce();
  });

  it("unsubscribe() stops receiving messages", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const handler = vi.fn();
    const unsub = bus.subscribe("agent-a", handler);

    bus.publish(makeMsg({ to: "agent-a", tick: 1 }));
    expect(handler).toHaveBeenCalledOnce();

    unsub();
    bus.publish(makeMsg({ to: "agent-a", tick: 1 }));
    expect(handler).toHaveBeenCalledOnce();
  });
});
