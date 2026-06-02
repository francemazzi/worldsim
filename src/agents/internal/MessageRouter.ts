import { createMessageId } from "../../messaging/MessageBus.js";
import type { MessageBus } from "../../messaging/MessageBus.js";
import type { Message } from "../../messaging/Message.js";
import type { AgentAction } from "../../types/AgentTypes.js";
import type { GraphStore } from "../../types/GraphTypes.js";
import type { NeighborhoodManager } from "../../graph/NeighborhoodManager.js";
import type { ConversationManager } from "../../messaging/ConversationManager.js";
import type { LocationIndex } from "../../location/LocationIndex.js";
import type { StimulusBus } from "../../perception/StimulusBus.js";
import { createStimulusId } from "../../perception/StimulusBus.js";
import type { PerceptionEngine } from "../../perception/PerceptionEngine.js";
import type { Stimulus } from "../../types/StimulusTypes.js";
import type { TopicTracker } from "../../perception/TopicTracker.js";
import type { PluginRegistry } from "../../plugins/PluginRegistry.js";
import type { WorldContext } from "../../types/WorldTypes.js";

export interface MessageRouterDeps {
  conversationManager?: ConversationManager | undefined;
  neighborhoodManager?: NeighborhoodManager | undefined;
  graphStore?: GraphStore | undefined;
  locationIndex?: LocationIndex | undefined;
  defaultBroadcastRadius?: number | undefined;
  stimulusBus?: StimulusBus | undefined;
  perceptionEngine?: PerceptionEngine | undefined;
  topicTracker?: TopicTracker | undefined;
  pluginRegistry?: Pick<
    PluginRegistry,
    "runStimulusEmitHooks" | "runPerceptDeliveredHooks"
  > | undefined;
  getWorldContext?: (() => WorldContext) | undefined;
  /**
   * When the perception layer is active and no perceiver picked the speech
   * up, fall back to the legacy cascade. When false (the strict realistic
   * default) the speech simply doesn't reach anyone.
   */
  perceptionFallbackToLegacy?: boolean | undefined;
}

type PerceptionPublishResult =
  | { status: "reached" }
  | { status: "unreached"; reason: string }
  | { status: "cancelled" };

/**
 * Publishes an agent's action to the most relevant audience.
 *
 * Two modes coexist:
 *
 *   - **Perception** mode (when both `stimulusBus` and `perceptionEngine`
 *     are wired): the action is converted into a `Stimulus` published on
 *     the stimulus bus, and the corresponding chat-room style messages are
 *     emitted only to the agents whose senses actually picked it up.
 *
 *   - **Legacy** cascade (default): conversation participants
 *     → neighborhood peers (if configured + graph store available)
 *     → agents within proximity radius (if locationIndex + radius set)
 *     → global broadcast (fallback).
 *
 * The legacy behavior is preserved when no perception layer is supplied so
 * existing scenarios keep working unchanged.
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
    const actionMetadata = action.metadata as
      | (Record<string, unknown> & Message["metadata"])
      | undefined;
    const msg: Omit<Message, "to"> = {
      id: createMessageId(),
      from: agentId,
      type: "speak" as const,
      content: JSON.stringify(action.payload),
      tick,
      ...(actionMetadata ? { metadata: actionMetadata } : {}),
    };

    // Phase 1: perception path takes precedence when wired.
    if (this.deps.stimulusBus && this.deps.perceptionEngine) {
      const result = await this.publishViaPerception(agentId, action, msg, tick);
      if (result.status === "reached" || result.status === "cancelled") return;
      if (!this.deps.perceptionFallbackToLegacy) {
        // Strict realistic mode: speech evaporates if no one perceives it.
        console.warn(
          `[MessageRouter] Perception dropped speech from "${agentId}" at tick ${tick}: ${result.reason}.`,
        );
        return;
      }
      // else fall through to legacy cascade.
    }

    if (this.deps.conversationManager) {
      const conv = this.deps.conversationManager.getConversationForAgent(agentId);
      if (conv) {
        const recipients = conv.participantIds.filter((id) => id !== agentId);
        this.bus.publishToGroup(
          {
            ...msg,
            metadata: {
              ...(msg.metadata ?? {}),
              conversationId: conv.id,
              threadId: `conversation:${conv.id}`,
              audienceKey: audienceKey(conv.participantIds),
            },
          },
          recipients,
        );
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
        this.bus.publishToGroup(
          {
            ...msg,
            metadata: {
              ...(msg.metadata ?? {}),
              threadId: `neighborhood:${audienceKey([agentId, ...neighbors])}`,
              audienceKey: audienceKey([agentId, ...neighbors]),
            },
          },
          neighbors,
        );
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
        const recipients = nearby.map((n) => n.agentId);
        this.bus.publishToGroup(
          {
            ...msg,
            metadata: {
              ...(msg.metadata ?? {}),
              threadId: `proximity:${audienceKey([agentId, ...recipients])}`,
              audienceKey: audienceKey([agentId, ...recipients]),
            },
          },
          recipients,
        );
        return;
      }
    }

    console.warn(
      `[MessageRouter] Agent "${agentId}" falling back to broadcast at tick ${tick}. ` +
        `Consider configuring neighborhood, location, or broadcastRadius.`,
    );
    this.bus.publish({
      ...msg,
      to: "*",
      metadata: {
        ...(msg.metadata ?? {}),
        threadId: "broadcast:*",
        audienceKey: "*",
      },
    });
  }

  /**
   * Emits the action as a stimulus on the StimulusBus, then mirrors it as
   * directed messages to whoever's senses picked the stimulus up. Returns
   * true when at least one perceiver was reached (so the caller knows to
   * skip the legacy cascade).
   */
  private async publishViaPerception(
    agentId: string,
    action: AgentAction,
    msg: Omit<Message, "to">,
    tick: number,
  ): Promise<PerceptionPublishResult> {
    const bus = this.deps.stimulusBus!;
    const engine = this.deps.perceptionEngine!;

    const actionMeta = (action.metadata as Record<string, unknown> | undefined) ?? {};
    let stim: Stimulus = {
      id: createStimulusId(),
      kind: "speech",
      channel: "sound",
      source: { kind: "agent", id: agentId },
      tick,
      intensity: extractSpeechIntensity(action),
      payload: action.payload,
      ...(actionMeta["topicId"] != null
        ? { topicId: String(actionMeta["topicId"]) }
        : {}),
      ...(actionMeta["inResponseTo"] != null
        ? { causedByStimulusId: String(actionMeta["inResponseTo"]) }
        : {}),
      metadata: {
        ...actionMeta,
        messageId: msg.id,
      },
    };

    const worldCtx = this.deps.getWorldContext?.();
    if (this.deps.pluginRegistry && worldCtx) {
      const transformed = await this.deps.pluginRegistry.runStimulusEmitHooks(
        stim,
        worldCtx,
      );
      if (!transformed) return { status: "cancelled" };
      stim = transformed;
    }

    const topicId = this.deps.topicTracker?.ingest(stim);
    if (topicId) stim.topicId = topicId;

    bus.publish(stim);

    // Build the per-receiver message set from the perception engine.
    const allPercepts = engine.perceiveAll(bus, tick);
    const recipients: string[] = [];
    for (const [perceiverId, percepts] of allPercepts) {
      if (perceiverId === agentId) continue;
      const delivered = this.deps.pluginRegistry && worldCtx
        ? await this.deps.pluginRegistry.runPerceptDeliveredHooks(
            perceiverId,
            percepts,
            worldCtx,
          )
        : percepts;
      const heardThis = delivered.some((p) => p.stimulus.id === stim.id);
      if (heardThis) recipients.push(perceiverId);
    }

    if (recipients.length === 0) {
      return {
        status: "unreached",
        reason: engine.explainUndelivered(stim, agentId),
      };
    }

    this.bus.publishToGroup(
      {
        ...msg,
        metadata: {
          ...(msg.metadata ?? {}),
          stimulusId: stim.id,
          ...(stim.topicId ? { topicId: stim.topicId } : {}),
          ...(stim.causedByStimulusId ? { inResponseTo: stim.causedByStimulusId } : {}),
          threadId: stim.topicId ? `perception:${stim.topicId}` : `perception:${stim.id}`,
          audienceKey: audienceKey([agentId, ...recipients]),
        },
      },
      recipients,
    );
    return { status: "reached" };
  }
}

function extractSpeechIntensity(action: AgentAction): number {
  const meta = action.metadata as Record<string, unknown> | undefined;
  const explicit = meta?.["intensity"];
  if (typeof explicit === "number") {
    return Math.max(0, Math.min(1, explicit));
  }
  return 0.7;
}

function audienceKey(agentIds: string[]): string {
  return [...new Set(agentIds)].sort().join("|");
}
