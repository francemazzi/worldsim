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
}

export interface ConversationTurn {
  conversationId: string;
  speakerId: string;
  content: string;
  tick: number;
  turnNumber: number;
}
