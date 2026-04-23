import { describe, expect, it, vi } from "vitest";
import { MessageBus, createMessageId } from "../../src/messaging/MessageBus.js";
import type { Message } from "../../src/messaging/Message.js";

function msg(to: string, overrides: Partial<Message> = {}): Message {
  return {
    id: createMessageId(),
    from: "maria",
    to,
    type: "sms",
    content: "ciao",
    tick: 0,
    ...overrides,
  };
}

describe("MessageBus federation routing", () => {
  it("delivers locally when no external router is configured", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    bus.publish(msg("luca", { tick: 1 }));
    expect(bus.getMessages("luca", 1)).toHaveLength(1);
  });

  it("delegates external federated ids to the router", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const router = vi.fn();
    bus.setExternalRouter("firenze", router);

    bus.publish(msg("roma:luca", { tick: 1 }));

    expect(router).toHaveBeenCalledTimes(1);
    expect(router.mock.calls[0]?.[0]?.to).toBe("roma:luca");
    // Not delivered locally to anyone
    expect(bus.getAllMessagesForTick(1)).toHaveLength(0);
  });

  it("strips the local world prefix and delivers to the bare agent id", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const router = vi.fn();
    bus.setExternalRouter("firenze", router);

    bus.publish(msg("firenze:luca", { tick: 1 }));

    expect(router).not.toHaveBeenCalled();
    const delivered = bus.getMessages("luca", 1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.to).toBe("luca");
  });

  it("does not delegate broadcast messages", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const router = vi.fn();
    bus.setExternalRouter("firenze", router);

    bus.publish(msg("*", { tick: 1 }));

    expect(router).not.toHaveBeenCalled();
    expect(bus.getMessages("luca", 1)).toHaveLength(1);
  });

  it("setExternalRouter(undefined) detaches the router", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const router = vi.fn();
    bus.setExternalRouter("firenze", router);
    bus.setExternalRouter("firenze", undefined);

    bus.publish(msg("roma:luca", { tick: 1 }));
    expect(router).not.toHaveBeenCalled();
    // Without routing, the message is "delivered" to a non-existent recipient locally
    expect(bus.getAllMessagesForTick(1)).toHaveLength(1);
  });

  it("does not crash if the router throws asynchronously", async () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    bus.setExternalRouter("firenze", () => {
      throw new Error("router boom");
    });
    expect(() => bus.publish(msg("roma:luca", { tick: 1 }))).not.toThrow();
    // Allow microtask queue to flush
    await Promise.resolve();
    await Promise.resolve();
    expect(consoleWarn).toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});
