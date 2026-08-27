import { describe, expect, it } from "vitest";
import { MessageRouter } from "../../src/agents/internal/MessageRouter.js";
import { MessageBus } from "../../src/messaging/MessageBus.js";
import { ConversationManager } from "../../src/messaging/ConversationManager.js";
import { PluginRegistry } from "../../src/plugins/PluginRegistry.js";
import type { MessageDeliveryReceipt } from "../../src/messaging/Message.js";

describe("message routing plugin integration", () => {
  it("persists a final receipt through the public plugin hook", async () => {
    const stored = new Map<string, MessageDeliveryReceipt>();
    const plugins = new PluginRegistry();
    plugins.register({
      name: "receipt-persistence",
      version: "1.0.0",
      onMessageRouted: async (receipt) => {
        stored.set(receipt.messageId, receipt);
      },
    });

    const bus = new MessageBus();
    bus.newTick(3);
    const conversations = new ConversationManager();
    const conversation = conversations.startConversation(
      "agent-a",
      ["agent-b"],
      "coordination",
      3,
    );
    const router = new MessageRouter(bus, {
      conversationManager: conversations,
      pluginRegistry: plugins,
      getWorldContext: () => ({
        worldId: "integration-world",
        tickCount: 3,
        startedAt: new Date(),
        metadata: {},
      }),
    });

    const receipt = await router.publish(
      "agent-a",
      {
        agentId: "agent-a",
        actionType: "speak",
        payload: { text: "ready" },
        tick: 3,
        metadata: {
          custom: { workflowId: "workflow-1" },
        },
      },
      3,
      false,
    );

    expect(stored.get(receipt.messageId)).toEqual(receipt);
    expect(receipt).toMatchObject({
      route: "conversation",
      recipients: ["agent-b"],
      metadata: {
        conversationId: conversation.id,
        custom: { workflowId: "workflow-1" },
      },
    });
  });
});
