import { randomUUID } from "node:crypto";
import { WorldClock } from "./WorldClock.js";
import { createWorldContext } from "./WorldContext.js";
import { AgentRegistry } from "../agents/AgentRegistry.js";
import { ControlAgent } from "../agents/ControlAgent.js";
import { PersonAgent } from "../agents/PersonAgent.js";
import { MessageBus } from "../messaging/MessageBus.js";
import { RulesLoader, buildRulesContext } from "../rules/RulesLoader.js";
import { PluginRegistry } from "../plugins/PluginRegistry.js";
import { LLMAdapterPool } from "../llm/LLMAdapterPool.js";
import type { LLMAdapter } from "../llm/LLMAdapter.js";
import { BatchExecutor } from "./BatchExecutor.js";
import { ActivityScheduler } from "../scheduling/ActivityScheduler.js";
import { TokenBudgetTracker } from "../scheduling/TokenBudgetTracker.js";
import { NeighborhoodManager } from "../graph/NeighborhoodManager.js";
import { ConversationManager } from "../messaging/ConversationManager.js";
import { LocationIndex } from "../location/LocationIndex.js";
import type { Conversation } from "../types/ConversationTypes.js";
import type {
  WorldConfig,
  WorldContext,
  WorldStatus,
  WorldEvent,
} from "../types/WorldTypes.js";
import type {
  AgentConfig,
  AgentAction,
  AgentStatus,
  AgentControlEvent,
} from "../types/AgentTypes.js";
import type { RulesContext } from "../types/RulesTypes.js";
import type { WorldSimPlugin } from "../types/PluginTypes.js";
import type { BaseAgent } from "../agents/BaseAgent.js";
import type { AgentStoreOptions } from "../agents/BaseAgent.js";
import { BrainMemory } from "../memory/BrainMemory.js";
import type { ConsolidationResult } from "../types/ConsolidationTypes.js";

type TickHandler = (tick: number) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WorldEngine {
  private _status: WorldStatus = "idle";
  private config: WorldConfig;
  private context: WorldContext;
  private agentRegistry: AgentRegistry = new AgentRegistry();
  private messageBus: MessageBus = new MessageBus();
  private rulesContext: RulesContext | null = null;
  private pluginRegistry: PluginRegistry = new PluginRegistry();
  private llmPool: LLMAdapterPool;
  private clock: WorldClock = new WorldClock();
  private controlAgents: ControlAgent[] = [];
  private personAgents: PersonAgent[] = [];
  private eventLog: WorldEvent[] = [];
  private pendingAgentConfigs: AgentConfig[] = [];
  private tickHandlers: TickHandler[] = [];
  private brainMemory?: BrainMemory | undefined;
  private batchExecutor: BatchExecutor;
  private activityScheduler: ActivityScheduler = new ActivityScheduler();
  private tokenBudgetTracker: TokenBudgetTracker = new TokenBudgetTracker();
  private neighborhoodManager: NeighborhoodManager = new NeighborhoodManager();
  private conversationManager: ConversationManager = new ConversationManager();
  private locationIndex: LocationIndex = new LocationIndex();

  constructor(config: WorldConfig) {
    this.config = config;
    this.context = createWorldContext(config.worldId ?? randomUUID());
    this.llmPool = new LLMAdapterPool(config.llm);
    this.batchExecutor = new BatchExecutor(config.maxConcurrentAgents);
  }

  /** @deprecated Use llmPool.getWorldAdapter() internally. Kept for backward compatibility. */
  private get llm(): LLMAdapter {
    return this.llmPool.getWorldAdapter();
  }

  use(plugin: WorldSimPlugin): this {
    this.pluginRegistry.register(plugin);
    return this;
  }

  addAgent(config: AgentConfig): this {
    this.pendingAgentConfigs.push(config);
    return this;
  }

  on(event: "tick", handler: TickHandler): this {
    if (event === "tick") {
      this.tickHandlers.push(handler);
    }
    return this;
  }

  async start(): Promise<void> {
    this._status = "bootstrapping";

    const rulesLoader = new RulesLoader(this.llm);
    this.rulesContext = this.config.rulesPath
      ? await rulesLoader.load(this.config.rulesPath)
      : buildRulesContext([]);

    await this.pluginRegistry.runHook(
      "onBootstrap",
      this.context,
      this.rulesContext,
    );
    await this.pluginRegistry.runHook("onRulesLoaded", this.rulesContext);

    // Auto-compose BrainMemory if vector or persistence store is provided
    if (
      this.config.memoryStore &&
      (this.config.vectorStore || this.config.persistenceStore)
    ) {
      this.brainMemory = new BrainMemory({
        memoryStore: this.config.memoryStore,
        vectorStore: this.config.vectorStore,
        persistenceStore: this.config.persistenceStore,
        embeddingAdapter: this.config.embeddingAdapter,
        graphStore: this.config.graphStore,
        llm: this.llm,
        consolidation: this.config.consolidation,
      });
    }

    for (const agentConfig of this.pendingAgentConfigs) {
      const agentLlm = this.llmPool.getAdapter(agentConfig);

      const storeOptions: AgentStoreOptions = {
        memoryStore: this.config.memoryStore,
        graphStore: this.config.graphStore,
        vectorStore: this.config.vectorStore,
        persistenceStore: this.config.persistenceStore,
        embeddingAdapter: this.config.embeddingAdapter,
        brainMemory: this.brainMemory,
        activityScheduler: this.activityScheduler,
        tokenBudgetTracker: this.tokenBudgetTracker,
        neighborhoodManager: this.neighborhoodManager,
        conversationManager: this.conversationManager,
      };

      if (agentConfig.role === "control") {
        const agent = new ControlAgent(
          agentConfig,
          agentLlm,
          this.messageBus,
          storeOptions,
        );
        this.controlAgents.push(agent);
        this.agentRegistry.add(agent);
      } else {
        const agent = new PersonAgent(
          agentConfig,
          agentLlm,
          this.messageBus,
          storeOptions,
        );
        const pluginTools = agentConfig.toolNames
          ? this.pluginRegistry.getToolsByNames(agentConfig.toolNames)
          : this.pluginRegistry.getAllTools();
        agent.setTools(pluginTools);
        this.personAgents.push(agent);
        this.agentRegistry.add(agent);

        // Configure neighborhood if specified
        if (agentConfig.neighborhood) {
          const nhConfig: Record<string, unknown> = {};
          if (agentConfig.neighborhood.maxContacts != null) {
            nhConfig.maxContacts = agentConfig.neighborhood.maxContacts;
          }
          if (agentConfig.neighborhood.groups != null) {
            nhConfig.groups = agentConfig.neighborhood.groups;
          }
          this.neighborhoodManager.configure(agent.id, nhConfig as Partial<import("../graph/NeighborhoodManager.js").NeighborhoodConfig>);
        }

        // Register location if specified
        if (agentConfig.profile?.location) {
          const loc = agentConfig.profile.location.current ?? agentConfig.profile.location.home;
          if (loc) {
            this.locationIndex.update(agent.id, loc);
          }
        }
      }
    }

    for (const ca of this.controlAgents) {
      ca.start(0);
      await ca.bootstrap(this.rulesContext);
    }

    for (const pa of this.personAgents) {
      pa.start(0);
    }

    this._status = "running";
    await this.runLoop();
  }

  async stop(): Promise<void> {
    this._status = "stopped";

    for (const agent of this.agentRegistry.list()) {
      if (agent.status !== "stopped") {
        agent.stop(this.clock.current());
      }
    }

    await this.pluginRegistry.runHook(
      "onWorldStop",
      this.context,
      this.eventLog,
    );

    this.agentRegistry.clear();
    this.messageBus.clear();
    this.controlAgents = [];
    this.personAgents = [];
  }

  async pause(): Promise<void> {
    this._status = "paused";
  }

  async resume(): Promise<void> {
    if (this._status === "paused") {
      this._status = "running";
      await this.runLoop();
    }
  }

  agent(id: string): BaseAgent {
    return this.agentRegistry.getOrThrow(id);
  }

  pauseAgent(id: string, reason?: string): this {
    const a = this.agent(id);
    const oldStatus = a.status;
    a.pause(this.clock.current(), "host");

    this.logEvent("agent:paused", id, { reason });
    this.pluginRegistry.runHook(
      "onAgentStatusChange",
      {
        type: "agent:pause",
        agentId: id,
        requestedBy: "host",
        tick: this.clock.current(),
        reason,
      },
      oldStatus,
      a.status,
    );

    return this;
  }

  resumeAgent(id: string): this {
    const a = this.agent(id);
    const oldStatus = a.status;
    a.resume(this.clock.current(), "host");

    this.logEvent("agent:resumed", id, {});
    this.pluginRegistry.runHook(
      "onAgentStatusChange",
      {
        type: "agent:resume",
        agentId: id,
        requestedBy: "host",
        tick: this.clock.current(),
      },
      oldStatus,
      a.status,
    );

    return this;
  }

  stopAgent(id: string, reason?: string): this {
    const a = this.agent(id);
    const oldStatus = a.status;
    a.stop(this.clock.current(), "host");

    this.agentRegistry.remove(id);
    this.personAgents = this.personAgents.filter((p) => p.id !== id);
    this.controlAgents = this.controlAgents.filter((c) => c.id !== id);

    this.logEvent("agent:stopped", id, { reason });
    this.pluginRegistry.runHook(
      "onAgentStatusChange",
      {
        type: "agent:stop",
        agentId: id,
        requestedBy: "host",
        tick: this.clock.current(),
        reason,
      },
      oldStatus,
      "stopped",
    );

    return this;
  }

  getAgentStatuses(): Record<string, AgentStatus> {
    const result: Record<string, AgentStatus> = {};
    for (const agent of this.agentRegistry.list()) {
      result[agent.id] = agent.status;
    }
    return result;
  }

  getStatus(): WorldStatus {
    return this._status;
  }

  getContext(): Readonly<WorldContext> {
    return this.context;
  }

  getEventLog(): Readonly<WorldEvent[]> {
    return this.eventLog;
  }

  getAgent(id: string): BaseAgent | undefined {
    return this.agentRegistry.get(id);
  }

  async consolidate(): Promise<ConsolidationResult[]> {
    if (!this.brainMemory) return [];
    const results: ConsolidationResult[] = [];
    const worldId = this.context.worldId;
    for (const agent of this.agentRegistry.list()) {
      const result = await this.brainMemory.consolidate(agent.id, worldId);
      results.push(result);
    }
    return results;
  }

  /**
   * Creates a structured conversation between agents with turn-taking.
   */
  createConversation(
    initiatorId: string,
    participantIds: string[],
    topic?: string,
  ): Conversation {
    return this.conversationManager.startConversation(
      initiatorId,
      participantIds,
      topic,
      this.clock.current(),
    );
  }

  /**
   * Ends an active conversation.
   */
  endConversation(conversationId: string): void {
    this.conversationManager.endConversation(conversationId);
  }

  /**
   * Returns the location index for spatial queries.
   */
  getLocationIndex(): LocationIndex {
    return this.locationIndex;
  }

  /**
   * Returns the neighborhood manager.
   */
  getNeighborhoodManager(): NeighborhoodManager {
    return this.neighborhoodManager;
  }

  /**
   * Returns the conversation manager.
   */
  getConversationManager(): ConversationManager {
    return this.conversationManager;
  }

  private async runLoop(): Promise<void> {
    const maxTicks = this.config.maxTicks ?? Infinity;
    const interval = this.config.tickIntervalMs ?? 0;

    while (this._status === "running" && this.clock.current() < maxTicks) {
      await this.executeTick();
      if (interval > 0) await sleep(interval);
    }

    if (this._status === "running") {
      this._status = "stopped";
      await this.pluginRegistry.runHook(
        "onWorldStop",
        this.context,
        this.eventLog,
      );
    }
  }

  private async executeTick(): Promise<void> {
    const tick = this.clock.increment();
    this.messageBus.newTick(tick);
    this.context.tickCount = tick;

    await this.pluginRegistry.runHook("onWorldTick", tick, this.context);

    for (const handler of this.tickHandlers) {
      try {
        handler(tick);
      } catch {
        // ignore tick handler errors
      }
    }

    // Reset per-tick token counters
    this.tokenBudgetTracker.resetAllTicks(tick);

    // Cleanup stale conversations
    this.conversationManager.tickCleanup(tick);

    // Filter active agents and sort by priority (agents with pending messages first)
    const activePersonAgents = this.personAgents
      .filter((a) => a.isActive)
      .sort((a, b) => {
        const aMsgs = this.messageBus.getMessages(a.id, tick).length;
        const bMsgs = this.messageBus.getMessages(b.id, tick).length;
        return bMsgs - aMsgs; // More messages = higher priority
      });

    const allActions: AgentAction[] = [];

    // Execute agents through batch executor with concurrency limit
    const tasks = activePersonAgents.map((agent) => {
      return async () => {
        const actions = await agent.tick(this.context, this.rulesContext!);
        return actions;
      };
    });

    const results = await this.batchExecutor.execute(tasks);
    for (const actions of results) {
      allActions.push(...actions);
    }

    this.applyControlMessages(tick);

    if (this.controlAgents.length > 0 && allActions.length > 0) {
      for (const ca of this.controlAgents) {
        if (!ca.isActive) continue;
        const evaluations = await ca.evaluateActions(
          allActions,
          this.context,
          this.rulesContext!,
        );

        for (const evaluation of evaluations) {
          if (evaluation.verdict === "blocked") {
            this.logEvent("action:blocked", evaluation.agentId, {
              reason: evaluation.reason,
            });
          } else if (evaluation.verdict === "warned") {
            this.logEvent("action:warned", evaluation.agentId, {
              suggestion: evaluation.suggestion,
            });
          } else {
            this.logEvent("action:executed", evaluation.agentId, {});
          }
        }
      }
    } else {
      for (const action of allActions) {
        this.logEvent("action:executed", action.agentId, {
          actionType: action.actionType,
        });
      }
    }

    for (const action of allActions) {
      await this.pluginRegistry.runHookWithTransform(
        "onAgentAction",
        action,
        {
          agentId: action.agentId,
          status: "running",
          currentMessages: [],
          loopCount: 0,
          ephemeralMemory: {},
        },
      );
    }

    for (const ca of this.controlAgents) {
      if (ca.isActive) {
        await ca.tick(this.context, this.rulesContext!);
      }
    }
  }

  private applyControlMessages(tick: number): void {
    const messages = this.messageBus.getMessages("world-engine", tick);

    for (const msg of messages) {
      if (msg.type !== "system") continue;

      let event: AgentControlEvent;
      try {
        event = JSON.parse(msg.content) as AgentControlEvent;
      } catch {
        continue;
      }

      if (!event.type?.startsWith("agent:")) continue;

      const target = this.agentRegistry.get(event.agentId);
      if (!target) continue;

      const oldStatus = target.status;

      switch (event.type) {
        case "agent:pause":
          target.pause(tick, event.requestedBy);
          break;
        case "agent:resume":
          target.resume(tick, event.requestedBy);
          break;
        case "agent:stop":
          target.stop(tick, event.requestedBy);
          this.agentRegistry.remove(event.agentId);
          this.personAgents = this.personAgents.filter(
            (p) => p.id !== event.agentId,
          );
          break;
      }

      const newStatus = event.type === "agent:stop" ? "stopped" : target.status;

      this.logEvent(event.type.replace("agent:", "agent:") as string, event.agentId, {
        requestedBy: event.requestedBy,
        reason: event.reason,
      });

      this.pluginRegistry.runHook(
        "onAgentStatusChange",
        event,
        oldStatus,
        newStatus as AgentStatus,
      );
    }
  }

  private logEvent(
    type: string,
    agentId: string,
    payload: unknown,
  ): void {
    this.eventLog.push({
      type,
      tick: this.clock.current(),
      agentId,
      payload,
      timestamp: new Date(),
    });
  }
}
