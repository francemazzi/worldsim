import { createMessageId } from "../../messaging/MessageBus.js";
import type { MessageBus } from "../../messaging/MessageBus.js";
import type { AgentAction } from "../../types/AgentTypes.js";
import type { GraphStore } from "../../types/GraphTypes.js";
import type { NeighborhoodManager } from "../../graph/NeighborhoodManager.js";
import type { ConversationManager } from "../../messaging/ConversationManager.js";
import type { LocationIndex } from "../../location/LocationIndex.js";

export interface MessageRouterDeps {
  conversationManager?: ConversationManager | undefined;
  neighborhoodManager?: NeighborhoodManager | undefined;
  graphStore?: GraphStore | undefined;
  locationIndex?: LocationIndex | undefined;
  defaultBroadcastRadius?: number | undefined;
}

/**
 * Publishes an agent's action to the most relevant audience using a
 * deterministic cascade:
 *
 *   conversation participants
 *   → neighborhood peers (if configured + graph store available)
 *   → agents within proximity radius (if locationIndex + radius set)
 *   → global broadcast (fallback)
 *
 * Extracted from PersonAgent to keep message routing concerns separate
 * from tick/state/prompt logic (SRP).
 */
export class MessageRouter {
  constructor(
    private readonly bus: MessageBus,
    private readonly deps: MessageRouterDeps,
  ) {}

  async publish(
    agentId: string,
    action: AgentAction,
    tick: number,
    hasNeighborhoodConfig: boolean,
  ): Promise<void> {
    const msg = {
      id: createMessageId(),
      from: agentId,
      type: "speak" as const,
      content: JSON.stringify(action.payload),
      tick,
    };

    if (this.deps.conversationManager) {
      const conv = this.deps.conversationManager.getConversationForAgent(agentId);
      if (conv) {
        const recipients = conv.participantIds.filter((id) => id !== agentId);
        this.bus.publishToGroup(msg, recipients);
        return;
      }
    }

    if (
      this.deps.neighborhoodManager
      && this.deps.graphStore
      && hasNeighborhoodConfig
    ) {
      const neighbors = await this.deps.neighborhoodManager.getActiveNeighbors(
        agentId,
        this.deps.graphStore,
      );
      if (neighbors.length > 0) {
        this.bus.publishToGroup(msg, neighbors);
        return;
      }
    }

    if (
      this.deps.locationIndex
      && this.deps.defaultBroadcastRadius
      && this.deps.defaultBroadcastRadius > 0
    ) {
      const nearby = this.deps.locationIndex.findNearby(
        agentId,
        this.deps.defaultBroadcastRadius,
      );
      if (nearby.length > 0) {
        this.bus.publishToGroup(
          msg,
          nearby.map((n) => n.agentId),
        );
        return;
      }
    }

    console.warn(
      `[MessageRouter] Agent "${agentId}" falling back to broadcast at tick ${tick}. ` +
        `Consider configuring neighborhood, location, or broadcastRadius.`,
    );
    this.bus.publish({ ...msg, to: "*" });
  }
}
