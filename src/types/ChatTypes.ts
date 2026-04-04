export interface ChatMessage {
  id: string;
  sessionId: string;
  agentId: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  tick: number;
}

export interface ChatSession {
  id: string;
  agentId: string;
  userId: string;
  messages: ChatMessage[];
  createdAt: Date;
  lastMessageAt: Date;
}

/** Client → Server payload for sending a chat message. */
export interface ChatSendPayload {
  agentId: string;
  message: string;
  /** Omit to create a new session. */
  sessionId?: string;
}

/** Server → Client payload for a chat response. */
export interface ChatResponsePayload {
  agentId: string;
  agentName: string;
  sessionId: string;
  message: string;
  timestamp: string;
  state: {
    mood: string;
    energy: number;
    goals: string[];
  };
}

/** Server → Client payload for chat history. */
export interface ChatHistoryPayload {
  agentId: string;
  sessionId: string;
  messages: ChatMessage[];
}
