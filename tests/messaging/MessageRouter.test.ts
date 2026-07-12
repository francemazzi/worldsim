import { describe, expect, it, vi } from "vitest";
import {
  MessageRouter,
  type MessageRouterDeps,
} from "../../src/agents/internal/MessageRouter.js";
import { ConversationManager } from "../../src/messaging/ConversationManager.js";
import { MessageBus } from "../../src/messaging/MessageBus.js";
import { PluginRegistry } from "../../src/plugins/PluginRegistry.js";
import { LocationIndex } from "../../src/location/LocationIndex.js";
import type { AgentAction } from "../../src/types/AgentTypes.js";
import type { GraphStore } from "../../src/types/GraphTypes.js";
import type { NeighborhoodManager } from "../../src/graph/NeighborhoodManager.js";
import type { MessageDeliveryReceipt } from "../../src/messaging/Message.js";
import type { WorldContext } from "../../src/types/WorldTypes.js";

const worldContext: WorldContext = {
  worldId: "routing-test",
  tickCount: 1,
  startedAt: new Date(),
  metadata: {},
};

function speakAction(metadata?: AgentAction["metadata"]): AgentAction {
  return {
    agentId: "alice",
    actionType: "speak",
    payload: { text: "hello" },
    tick: 1,
    ...(metadata ? { metadata } : {}),
  };
}

function createObservedRouter(
  bus: MessageBus,
  deps: MessageRouterDeps = {},
): {
  router: MessageRouter;
  receipts: MessageDeliveryReceipt[];
} {
  const receipts: MessageDeliveryReceipt[] = [];
  const registry = new PluginRegistry();
  registry.register({
    name: "delivery-recorder",
    version: "1.0.0",
    onMessageRouted: async (receipt) => {
      receipts.push(receipt);
    },
  });
  return {
    router: new MessageRouter(bus, {
      ...deps,
      pluginRegistry: registry,
      getWorldContext: () => worldContext,
    }),
    receipts,
  };
}

describe("MessageRouter delivery contract", () => {
  it("reports exact conversation recipients and preserves custom metadata", async () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const conversations = new ConversationManager();
    const conversation = conversations.startConversation(
      "alice",
      ["bob", "carol"],
      "planning",
      1,
    );
    const { router, receipts } = createObservedRouter(bus, {
      conversationManager: conversations,
    });

    const receipt = await router.publish(
      "alice",
      speakAction({
        custom: { goalId: "goal-42", correlationId: "corr-7" },
      }),
      1,
      false,
    );

    expect(receipt).toMatchObject({
      from: "alice",
      recipients: ["bob", "carol"],
      route: "conversation",
      tick: 1,
      metadata: {
        conversationId: conversation.id,
        threadId: `conversation:${conversation.id}`,
        custom: { goalId: "goal-42", correlationId: "corr-7" },
      },
    });
    expect(receipts).toEqual([receipt]);
    expect(bus.getMessages("bob", 1)[0]?.metadata?.custom).toEqual({
      goalId: "goal-42",
      correlationId: "corr-7",
    });
    expect(bus.getMessages("carol", 1)).toHaveLength(1);
  });

  it("reports neighborhood delivery", async () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const neighborhoodManager = {
      getActiveNeighbors: vi.fn().mockResolvedValue(["bob", "carol"]),
    } as unknown as NeighborhoodManager;
    const graphStore = {} as GraphStore;
    const { router } = createObservedRouter(bus, {
      neighborhoodManager,
      graphStore,
    });

    const receipt = await router.publish(
      "alice",
      speakAction(),
      1,
      true,
    );

    expect(receipt.route).toBe("neighborhood");
    expect(receipt.recipients).toEqual(["bob", "carol"]);
  });

  it("reports proximity delivery", async () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const locations = new LocationIndex();
    locations.update("alice", { latitude: 45, longitude: 9 });
    locations.update("bob", { latitude: 45.0001, longitude: 9.0001 });
    const { router } = createObservedRouter(bus, {
      locationIndex: locations,
      defaultBroadcastRadius: 1,
    });

    const receipt = await router.publish(
      "alice",
      speakAction(),
      1,
      false,
    );

    expect(receipt.route).toBe("proximity");
    expect(receipt.recipients).toEqual(["bob"]);
  });

  it("keeps broadcast as the backward-compatible default", async () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const { router, receipts } = createObservedRouter(bus);

    const receipt = await router.publish(
      "alice",
      speakAction(),
      1,
      false,
    );

    expect(receipt).toMatchObject({
      route: "broadcast",
      recipients: "*",
      metadata: {
        threadId: "broadcast:*",
        audienceKey: "*",
      },
    });
    expect(receipts).toEqual([receipt]);
    expect(bus.getMessages("any-agent", 1)).toHaveLength(1);
  });

  it("drops unroutable speech without publishing when configured", async () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const { router, receipts } = createObservedRouter(bus, {
      unroutableMessagePolicy: "drop",
    });

    const receipt = await router.publish(
      "alice",
      speakAction(),
      1,
      false,
    );

    expect(receipt).toMatchObject({
      route: "dropped",
      recipients: [],
      reason: "no_routing_audience",
    });
    expect(receipts).toEqual([receipt]);
    expect(bus.getAllMessagesForTick(1)).toEqual([]);
  });

  it("records the dropped outcome before error policy rejects", async () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const { router, receipts } = createObservedRouter(bus, {
      unroutableMessagePolicy: "error",
    });

    await expect(
      router.publish("alice", speakAction(), 1, false),
    ).rejects.toThrow("No routing audience");

    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      route: "dropped",
      reason: "no_routing_audience",
    });
    expect(bus.getAllMessagesForTick(1)).toEqual([]);
  });
});
