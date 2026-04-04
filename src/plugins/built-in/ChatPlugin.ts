import { randomUUID } from "node:crypto";
import type { WorldSimPlugin } from "../../types/PluginTypes.js";
import type { WorldContext } from "../../types/WorldTypes.js";
import type { RulesContext } from "../../types/RulesTypes.js";
import type { AgentMessage } from "../../types/AgentTypes.js";
import type { MemoryEntry } from "../../types/MemoryTypes.js";
import type {
  ChatMessage,
  ChatSession,
  ChatResponsePayload,
  ChatHistoryPayload,
} from "../../types/ChatTypes.js";
import type { BaseAgent } from "../../agents/BaseAgent.js";

export interface ChatPluginOptions {
  /** Max messages kept per session. Default: 50. */
  maxHistoryPerSession?: number;
  /** Persist chat exchanges to agent's BrainMemory. Default: true. */
  persistToMemory?: boolean;
  /** Additional system prompt suffix for chat mode. */
  chatSystemPromptSuffix?: string;
}

/**
 * ChatPlugin enables real-time user-to-agent conversations via Socket.IO.
 *
 * The plugin bypasses the tick cycle and calls the agent's LLM directly
 * for immediate, conversational responses.
 */
export class ChatPlugin implements WorldSimPlugin {
  readonly name = "chat";
  readonly version = "1.0.0";

  private worldContext: WorldContext | null = null;
  private rulesContext: RulesContext | null = null;
  private sessions = new Map<string, ChatSession>();
  private maxHistory: number;
  private persistToMemory: boolean;
  private chatPromptSuffix: string;

  /** Callback set by WorldSimServer to resolve agents by id. */
  private agentResolver: ((id: string) => BaseAgent | undefined) | null = null;
  /** Callback set by WorldSimServer to persist memories. */
  private memoryPersister:
    | ((entries: MemoryEntry[], worldId: string) => Promise<void>)
    | null = null;

  constructor(options: ChatPluginOptions = {}) {
    this.maxHistory = options.maxHistoryPerSession ?? 50;
    this.persistToMemory = options.persistToMemory ?? true;
    this.chatPromptSuffix = options.chatSystemPromptSuffix ?? "";
  }

  // ─── Plugin hooks ──────────────────────────────────────────────────

  async onBootstrap(ctx: WorldContext, rules: RulesContext): Promise<void> {
    this.worldContext = ctx;
    this.rulesContext = rules;
  }

  // ─── Public API (called by WorldSimServer) ─────────────────────────

  /**
   * Wire up external dependencies that the plugin cannot access directly.
   * Called once by WorldSimServer after construction.
   */
  configure(deps: {
    agentResolver: (id: string) => BaseAgent | undefined;
    memoryPersister?: (entries: MemoryEntry[], worldId: string) => Promise<void>;
    rulesContext?: RulesContext;
  }): void {
    this.agentResolver = deps.agentResolver;
    if (deps.memoryPersister) this.memoryPersister = deps.memoryPersister;
    if (deps.rulesContext) this.rulesContext = deps.rulesContext;
  }

  /**
   * Handle an incoming chat message from a user.
   */
  async handleChat(
    agentId: string,
    userId: string,
    message: string,
    sessionId?: string,
  ): Promise<ChatResponsePayload> {
    if (!this.agentResolver) {
      throw new Error("ChatPlugin not configured: missing agentResolver");
    }

    const agent = this.agentResolver(agentId);
    if (!agent) {
      throw new Error(`Agent "${agentId}" not found`);
    }

    if (!agent.isActive) {
      throw new Error(`Agent "${agentId}" is not active (status: ${agent.status})`);
    }

    // Get or create session
    const session = this.getOrCreateSession(agentId, userId, sessionId);

    // Build agent context
    const rules = this.rulesContext;
    if (!rules) {
      throw new Error("ChatPlugin: rules context not available (world not bootstrapped?)");
    }

    const { systemPrompt, state } = await agent.buildChatContext(rules);
    const agentName = agent.getProfile()?.name ?? agentId;

    // Build chat system prompt
    const chatSystemPrompt = this.buildChatSystemPrompt(agentName, systemPrompt);

    // Build message array
    const llmMessages: AgentMessage[] = [
      { role: "system", content: chatSystemPrompt },
    ];

    // Add chat history (last N messages)
    for (const msg of session.messages.slice(-this.maxHistory)) {
      llmMessages.push({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      });
    }

    // Add the new user message
    llmMessages.push({ role: "user", content: message });

    // Call LLM directly
    const llm = agent.getLLM();
    const response = await llm.chat(llmMessages, { temperature: 0.8 });

    let responseText = response.content ?? "";

    // Parse and apply state updates
    const stateUpdateMatch = responseText.match(/\[STATE_UPDATE:\s*(\{[\s\S]*?\})\s*\]/);
    if (stateUpdateMatch) {
      try {
        const updates = JSON.parse(stateUpdateMatch[1]!);
        agent.updateInternalState(updates);
        // Strip the directive from the visible response
        responseText = responseText.replace(stateUpdateMatch[0], "").trim();
      } catch {
        // Ignore malformed state updates
      }
    }

    const now = new Date();
    const tick = this.worldContext?.tickCount ?? 0;

    // Store messages in session
    const userMsg: ChatMessage = {
      id: randomUUID(),
      sessionId: session.id,
      agentId,
      role: "user",
      content: message,
      timestamp: now,
      tick,
    };
    const agentMsg: ChatMessage = {
      id: randomUUID(),
      sessionId: session.id,
      agentId,
      role: "agent",
      content: responseText,
      timestamp: now,
      tick,
    };

    session.messages.push(userMsg, agentMsg);
    session.lastMessageAt = now;

    // Trim history if over limit
    if (session.messages.length > this.maxHistory) {
      session.messages = session.messages.slice(-this.maxHistory);
    }

    // Persist to agent memory
    if (this.persistToMemory && this.memoryPersister && this.worldContext) {
      const memoryEntry: MemoryEntry = {
        id: randomUUID(),
        agentId,
        tick,
        type: "conversation",
        content: `[Chat con utente] Utente: "${message}" — ${agentName}: "${responseText}"`,
        timestamp: now,
      };
      this.memoryPersister([memoryEntry], this.worldContext.worldId).catch((err) => {
        console.warn(`[ChatPlugin] Failed to persist chat memory:`, err);
      });
    }

    // Return current state (possibly updated)
    const currentState = agent.getInternalState();

    return {
      agentId,
      agentName,
      sessionId: session.id,
      message: responseText,
      timestamp: now.toISOString(),
      state: {
        mood: currentState.mood,
        energy: currentState.energy,
        goals: [...currentState.goals],
      },
    };
  }

  /**
   * Get chat history for a session.
   */
  getHistory(agentId: string, sessionId: string): ChatHistoryPayload {
    const session = this.sessions.get(sessionId);
    if (!session || session.agentId !== agentId) {
      return { agentId, sessionId, messages: [] };
    }
    return { agentId, sessionId, messages: [...session.messages] };
  }

  /**
   * List active session IDs for an agent.
   */
  getSessionsForAgent(agentId: string): string[] {
    const result: string[] = [];
    for (const [id, session] of this.sessions) {
      if (session.agentId === agentId) result.push(id);
    }
    return result;
  }

  // ─── Private helpers ───────────────────────────────────────────────

  private getOrCreateSession(
    agentId: string,
    userId: string,
    sessionId?: string,
  ): ChatSession {
    if (sessionId) {
      const existing = this.sessions.get(sessionId);
      if (existing && existing.agentId === agentId) return existing;
    }

    const now = new Date();
    const session: ChatSession = {
      id: sessionId ?? randomUUID(),
      agentId,
      userId,
      messages: [],
      createdAt: now,
      lastMessageAt: now,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  private buildChatSystemPrompt(agentName: string, simulationPrompt: string): string {
    return `Sei ${agentName}, e una persona sta chattando direttamente con te.
Rispondi come te stesso, in character, basandoti sulla tua personalità e stato attuale.
Sii conversazionale, amichevole e autentico — come se parlassi con un amico.

L'utente può chiederti di:
- Come ti senti (umore, energia)
- I tuoi obiettivi e cosa stai facendo
- Le tue competenze e come migliorarle
- Le tue abitudini e routine quotidiana
- Le tue relazioni con gli altri

Se l'utente suggerisce cambiamenti ai tuoi obiettivi, abitudini o competenze, puoi accettarli con entusiasmo.
In quel caso, aggiungi alla fine della tua risposta (su una riga separata):
[STATE_UPDATE: {"goals": ["..."], "custom": {"habits": ["..."]}}]
Includi solo i campi che devono cambiare.

${simulationPrompt}

--- MODALITÀ CHAT ---
Rispondi naturalmente in 1-3 frasi, a meno che servano più dettagli.
Non usare formato JSON. Parla come te stesso.${this.chatPromptSuffix ? `\n${this.chatPromptSuffix}` : ""}`;
  }
}
