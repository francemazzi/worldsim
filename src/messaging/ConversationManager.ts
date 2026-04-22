import { randomUUID } from "node:crypto";
import type { Conversation, ConversationMetadata } from "../types/ConversationTypes.js";

export interface StartCallOptions {
  callerId: string;
  calleeId: string;
  callerNumber?: string;
  calleeNumber?: string;
  tick?: number;
  /** Optional maximum number of turns for the call (default: unlimited). */
  maxTurns?: number;
}

export interface CanSpeakResult {
  allowed: boolean;
  reason?: string | undefined;
  conversationId?: string | undefined;
}

/**
 * Manages structured conversations with turn-taking.
 * Ensures agents speak in order and flags interruptions as rude behavior.
 */
export class ConversationManager {
  private conversations: Map<string, Conversation> = new Map();
  /** Maps agentId to their active conversationId */
  private agentConversations: Map<string, string> = new Map();
  /** Max ticks a conversation can be idle before being auto-ended */
  private staleThreshold: number;

  constructor(staleThreshold: number = 5) {
    this.staleThreshold = staleThreshold;
  }

  /**
   * Starts a new conversation. The initiator is the first speaker.
   */
  startConversation(
    initiatorId: string,
    participantIds: string[],
    topic?: string,
    tick: number = 0,
    metadata?: ConversationMetadata,
  ): Conversation {
    const allParticipants = [initiatorId, ...participantIds.filter((id) => id !== initiatorId)];

    const conversation: Conversation = {
      id: randomUUID(),
      initiatorId,
      participantIds: allParticipants,
      currentSpeakerId: initiatorId,
      turnNumber: 0,
      topic,
      startTick: tick,
      status: "active",
      metadata,
    };

    this.conversations.set(conversation.id, conversation);
    for (const pid of allParticipants) {
      this.agentConversations.set(pid, conversation.id);
    }

    return conversation;
  }

  /**
   * Starts a phone call between two agents. The caller is the first speaker.
   * The returned conversation has `metadata.kind === "call"` so the phone
   * plugin (and any integrator) can tell calls apart from face-to-face chats.
   *
   * Fails (returns undefined) if either participant is already in an active
   * conversation — mirroring a real "busy" line.
   */
  startCall(options: StartCallOptions): Conversation | undefined {
    const { callerId, calleeId, callerNumber, calleeNumber, tick = 0, maxTurns } = options;

    if (this.agentConversations.has(callerId)) return undefined;
    if (this.agentConversations.has(calleeId)) return undefined;

    const metadata: ConversationMetadata = {
      kind: "call",
      ...(callerNumber ? { callerNumber } : {}),
      ...(calleeNumber ? { calleeNumber } : {}),
    };

    const conversation = this.startConversation(
      callerId,
      [calleeId],
      callerNumber && calleeNumber ? `call:${callerNumber}->${calleeNumber}` : "call",
      tick,
      metadata,
    );
    if (maxTurns != null) conversation.maxTurns = maxTurns;
    return conversation;
  }

  /** Ends a call (alias of endConversation with intent-revealing name). */
  endCall(callId: string): void {
    this.endConversation(callId);
  }

  /** True if the given conversation id is an active phone call. */
  isCall(conversationId: string): boolean {
    const conv = this.conversations.get(conversationId);
    return !!conv && conv.status === "active" && conv.metadata?.kind === "call";
  }

  /**
   * Gets the current speaker for a conversation.
   */
  getCurrentSpeaker(conversationId: string): string | undefined {
    return this.conversations.get(conversationId)?.currentSpeakerId;
  }

  /**
   * Checks whether an agent is allowed to speak right now.
   * Returns allowed=true if:
   * - Agent is not in any conversation (free to speak)
   * - Agent is the current speaker in their conversation
   */
  canSpeak(agentId: string): CanSpeakResult {
    const convId = this.agentConversations.get(agentId);
    if (!convId) {
      return { allowed: true };
    }

    const conv = this.conversations.get(convId);
    if (!conv || conv.status === "ended") {
      this.agentConversations.delete(agentId);
      return { allowed: true };
    }

    if (conv.currentSpeakerId === agentId) {
      return { allowed: true, conversationId: convId };
    }

    return {
      allowed: false,
      reason: `Not your turn. Current speaker: ${conv.currentSpeakerId}`,
      conversationId: convId,
    };
  }

  /**
   * Advances the turn to the next participant after the current speaker.
   * Round-robin among participants.
   */
  advanceTurn(conversationId: string, speakerId: string, currentTick: number): void {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.status === "ended") return;
    if (conv.currentSpeakerId !== speakerId) return;

    conv.turnNumber += 1;

    // Check if max turns reached
    if (conv.maxTurns != null && conv.turnNumber >= conv.maxTurns) {
      this.endConversation(conversationId);
      return;
    }

    // Round-robin: next participant
    const currentIndex = conv.participantIds.indexOf(speakerId);
    const nextIndex = (currentIndex + 1) % conv.participantIds.length;
    conv.currentSpeakerId = conv.participantIds[nextIndex] ?? speakerId;
  }

  /**
   * Ends a conversation and frees all participants.
   */
  endConversation(conversationId: string): void {
    const conv = this.conversations.get(conversationId);
    if (!conv) return;

    conv.status = "ended";
    for (const pid of conv.participantIds) {
      if (this.agentConversations.get(pid) === conversationId) {
        this.agentConversations.delete(pid);
      }
    }
  }

  /**
   * Cleans up stale conversations that haven't progressed.
   */
  tickCleanup(currentTick: number): void {
    for (const [id, conv] of this.conversations) {
      if (conv.status === "ended") {
        this.conversations.delete(id);
        continue;
      }
      if (currentTick - conv.startTick - conv.turnNumber > this.staleThreshold) {
        this.endConversation(id);
        this.conversations.delete(id);
      }
    }
  }

  /**
   * Gets the active conversation for an agent, if any.
   */
  getConversationForAgent(agentId: string): Conversation | undefined {
    const convId = this.agentConversations.get(agentId);
    if (!convId) return undefined;
    const conv = this.conversations.get(convId);
    if (!conv || conv.status === "ended") {
      this.agentConversations.delete(agentId);
      return undefined;
    }
    return conv;
  }

  getConversation(conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationId);
  }

  get activeCount(): number {
    let count = 0;
    for (const conv of this.conversations.values()) {
      if (conv.status === "active") count++;
    }
    return count;
  }

  /**
   * Returns a snapshot of every conversation tracked so far (active and ended).
   * Safe to iterate: the caller gets a detached array copy.
   */
  getAll(): Conversation[] {
    return [...this.conversations.values()];
  }

  clear(): void {
    this.conversations.clear();
    this.agentConversations.clear();
  }
}
