import { AgentLifecycle } from "./AgentLifecycle.js";
import {
  buildProfilePrompt,
  buildStatePrompt,
  buildMemoryPrompt,
  buildRelationshipPrompt,
  buildKnowledgePrompt,
  buildSemanticMemoryPrompt,
} from "./ProfilePromptBuilder.js";
import type { MessageBus } from "../messaging/MessageBus.js";
import { createMessageId } from "../messaging/MessageBus.js";
import type { LLMAdapter } from "../llm/LLMAdapter.js";
import type {
  AgentConfig,
  AgentAction,
  AgentStatus,
  AgentControlEvent,
  AgentMessage,
  AgentProfile,
  AgentInternalState,
} from "../types/AgentTypes.js";
import type { WorldContext, WorldEvent } from "../types/WorldTypes.js";
import type { RulesContext, Rule } from "../types/RulesTypes.js";
import type { MemoryStore, MemoryEntry } from "../types/MemoryTypes.js";
import type { GraphStore, Relationship } from "../types/GraphTypes.js";
import type { VectorStore, EmbeddingAdapter } from "../types/VectorTypes.js";
import type { PersistenceStore, ConsolidatedKnowledge } from "../types/PersistenceTypes.js";
import type { Message } from "../messaging/Message.js";
import type { BrainMemory } from "../memory/BrainMemory.js";
import type { ActivitySchedule, TokenBudget } from "../types/ScheduleTypes.js";
import { ActivityScheduler } from "../scheduling/ActivityScheduler.js";
import { TokenBudgetTracker } from "../scheduling/TokenBudgetTracker.js";
import type { TokenBudgetResult } from "../scheduling/TokenBudgetTracker.js";
import type { NeighborhoodManager } from "../graph/NeighborhoodManager.js";
import type { ConversationManager } from "../messaging/ConversationManager.js";
import type { LocationIndex } from "../location/LocationIndex.js";

export interface AgentStoreOptions {
  memoryStore?: MemoryStore | undefined;
  graphStore?: GraphStore | undefined;
  vectorStore?: VectorStore | undefined;
  persistenceStore?: PersistenceStore | undefined;
  embeddingAdapter?: EmbeddingAdapter | undefined;
  brainMemory?: BrainMemory | undefined;
  activityScheduler?: ActivityScheduler | undefined;
  tokenBudgetTracker?: TokenBudgetTracker | undefined;
  neighborhoodManager?: NeighborhoodManager | undefined;
  conversationManager?: ConversationManager | undefined;
  locationIndex?: LocationIndex | undefined;
  /** Radius in km for proximity-based messaging (replaces broadcast). 0 = no proximity fallback. */
  defaultBroadcastRadius?: number | undefined;
}

export interface TickContext {
  memories: MemoryEntry[];
  relationships: Relationship[];
  relevantMemories?: MemoryEntry[] | undefined;
  knowledge?: ConsolidatedKnowledge[] | undefined;
}

const DEFAULT_INTERNAL_STATE: AgentInternalState = {
  mood: "neutral",
  energy: 100,
  goals: [],
  beliefs: {},
  knowledge: {},
  custom: {},
};

export abstract class BaseAgent {
  protected config: AgentConfig;
  protected llm: LLMAdapter;
  protected bus: MessageBus;
  protected memoryStore?: MemoryStore | undefined;
  protected graphStore?: GraphStore | undefined;
  protected brainMemory?: BrainMemory | undefined;
  protected activityScheduler?: ActivityScheduler | undefined;
  protected tokenBudgetTracker?: TokenBudgetTracker | undefined;
  protected neighborhoodManager?: NeighborhoodManager | undefined;
  protected conversationManager?: ConversationManager | undefined;
  protected locationIndex?: LocationIndex | undefined;
  protected defaultBroadcastRadius?: number | undefined;
  protected internalState: AgentInternalState;
  private lifecycle: AgentLifecycle = new AgentLifecycle();

  constructor(
    config: AgentConfig,
    llm: LLMAdapter,
    bus: MessageBus,
    options?: AgentStoreOptions,
  ) {
    this.config = config;
    this.llm = llm;
    this.bus = bus;
    this.memoryStore = options?.memoryStore;
    this.graphStore = options?.graphStore;
    this.brainMemory = options?.brainMemory;
    this.activityScheduler = options?.activityScheduler;
    this.tokenBudgetTracker = options?.tokenBudgetTracker;
    this.neighborhoodManager = options?.neighborhoodManager;
    this.conversationManager = options?.conversationManager;
    this.locationIndex = options?.locationIndex;
    this.defaultBroadcastRadius = options?.defaultBroadcastRadius;
    this.internalState = {
      ...DEFAULT_INTERNAL_STATE,
      ...config.initialState,
    };
  }

  get id(): string {
    return this.config.id;
  }

  get role(): AgentConfig["role"] {
    return this.config.role;
  }

  get status(): AgentStatus {
    return this.lifecycle.current;
  }

  get isActive(): boolean {
    return this.lifecycle.isActive;
  }

  getProfile(): AgentProfile | undefined {
    return this.config.profile;
  }

  getInternalState(): Readonly<AgentInternalState> {
    return this.internalState;
  }

  updateInternalState(updates: Partial<AgentInternalState>): void {
    if (updates.mood != null) this.internalState.mood = updates.mood;
    if (updates.energy != null) this.internalState.energy = updates.energy;
    if (updates.goals) this.internalState.goals = updates.goals;
    if (updates.beliefs) {
      Object.assign(this.internalState.beliefs, updates.beliefs);
    }
    if (updates.knowledge) {
      Object.assign(this.internalState.knowledge, updates.knowledge);
    }
    if (updates.custom) {
      Object.assign(this.internalState.custom, updates.custom);
    }
  }

  start(tick = 0): void {
    if (this.lifecycle.transition("start")) {
      this.emitLifecycleEvent("agent:start", "world-engine", tick);
    }
  }

  pause(tick = 0, requestedBy = "host"): void {
    if (this.lifecycle.transition("pause")) {
      this.emitLifecycleEvent("agent:pause", requestedBy, tick);
    }
  }

  resume(tick = 0, requestedBy = "host"): void {
    if (this.lifecycle.transition("resume")) {
      this.emitLifecycleEvent("agent:resume", requestedBy, tick);
    }
  }

  stop(tick = 0, requestedBy = "host"): void {
    if (this.lifecycle.transition("stop")) {
      this.emitLifecycleEvent("agent:stop", requestedBy, tick);
    }
  }

  protected shouldSkipTick(currentTick?: number): boolean {
    if (!this.lifecycle.isActive) return true;

    // Check activity schedule
    if (currentTick != null && this.activityScheduler) {
      if (!this.activityScheduler.shouldActivate(this.id, currentTick, this.config.schedule)) {
        return true;
      }
    }

    // Check token budget
    if (this.tokenBudgetTracker) {
      const result = this.tokenBudgetTracker.canProceed(this.id, this.config.tokenBudget);
      if (!result.allowed) {
        this.applyBudgetPolicy(result, currentTick ?? 0);
        return true;
      }
    }

    return false;
  }

  private applyBudgetPolicy(result: TokenBudgetResult, tick: number): void {
    switch (result.policy) {
      case "pause":
        this.pause(tick, "token-budget");
        break;
      case "stop":
        this.stop(tick, "token-budget");
        break;
      case "degrade":
        // Degrade is handled in PersonAgent.singleIteration by reducing maxTokens
        break;
    }
  }

  /**
   * Checks if the agent is in degraded mode due to token budget.
   */
  protected isDegraded(): boolean {
    if (!this.tokenBudgetTracker || !this.config.tokenBudget) return false;
    const result = this.tokenBudgetTracker.canProceed(this.id, this.config.tokenBudget);
    return !result.allowed && result.policy === "degrade";
  }

  abstract tick(ctx: WorldContext, rules: RulesContext): Promise<AgentAction[]>;

  protected buildSystemPrompt(
    rules: RulesContext,
    tickContext?: TickContext,
  ): string {
    const sections: string[] = [];

    if (this.config.profile) {
      sections.push(buildProfilePrompt(this.config.profile));
    }

    if (this.config.systemPrompt) {
      sections.push(this.config.systemPrompt);
    }

    if (this.config.profile || this.config.initialState) {
      sections.push(buildStatePrompt(this.internalState));
    }

    if (tickContext) {
      const memorySection = buildMemoryPrompt(tickContext.memories);
      if (memorySection) sections.push(memorySection);

      if (tickContext.relevantMemories && tickContext.relevantMemories.length > 0) {
        const semanticSection = buildSemanticMemoryPrompt(tickContext.relevantMemories);
        if (semanticSection) sections.push(semanticSection);
      }

      if (tickContext.knowledge && tickContext.knowledge.length > 0) {
        const knowledgeSection = buildKnowledgePrompt(tickContext.knowledge);
        if (knowledgeSection) sections.push(knowledgeSection);
      }

      const relSection = buildRelationshipPrompt(tickContext.relationships);
      if (relSection) sections.push(relSection);
    }

    const scopeRules = rules.getRulesForScope(
      this.config.role === "control" ? "control" : "person",
    );
    const allRules = rules.getRulesForScope("all");

    const uniqueRules = new Map<string, Rule>();
    for (const r of [...allRules, ...scopeRules]) {
      uniqueRules.set(r.id, r);
    }

    const rulesText = Array.from(uniqueRules.values())
      .sort((a, b) => a.priority - b.priority)
      .map((r) => `[${r.enforcement.toUpperCase()}] ${r.instruction}`)
      .join("\n");

    sections.push(`--- RULES ---\n${rulesText}`);

    return sections.join("\n\n");
  }

  protected emit(event: WorldEvent): void {
    this.bus.broadcast({
      id: createMessageId(),
      from: this.config.id,
      type: "observe",
      content: JSON.stringify(event),
      tick: event.tick,
    });
  }

  protected onMessage(handler: (msg: Message) => void): () => void {
    return this.bus.subscribe(this.config.id, handler);
  }

  private emitLifecycleEvent(
    type: AgentControlEvent["type"],
    requestedBy: string,
    tick: number,
    reason?: string,
  ): void {
    const event: AgentControlEvent = {
      type,
      agentId: this.config.id,
      requestedBy,
      tick,
      reason,
    };
    this.bus.publish({
      id: createMessageId(),
      from: this.config.id,
      to: "world-engine",
      type: "system",
      content: JSON.stringify(event),
      tick,
    });
  }
}
