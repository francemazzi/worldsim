/**
 * Distinguishes a face-to-face conversation from a phone call.
 * Integrators that only care about face-to-face dialogs can ignore "call".
 */
export type ConversationKind = "face_to_face" | "call";

export interface ConversationMetadata {
  kind?: ConversationKind;
  /** Phone number of the caller (populated when kind === "call"). */
  callerNumber?: string;
  /** Phone number of the callee (populated when kind === "call"). */
  calleeNumber?: string;
}

export interface Conversation {
  id: string;
  initiatorId: string;
  participantIds: string[];
  currentSpeakerId: string;
  turnNumber: number;
  maxTurns?: number | undefined;
  topic?: string | undefined;
  startTick: number;
  status: "active" | "ended";
  metadata?: ConversationMetadata | undefined;
}

export interface ConversationTurn {
  conversationId: string;
  speakerId: string;
  content: string;
  tick: number;
  turnNumber: number;
}
