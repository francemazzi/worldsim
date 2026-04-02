import { randomUUID } from "node:crypto";
import { WorldClock } from "./WorldClock.js";
import { createWorldContext } from "./WorldContext.js";
import { BatchExecutor } from "./BatchExecutor.js";
import { CircularBuffer } from "./CircularBuffer.js";
import { WorldBootstrapper } from "./internal/WorldBootstrapper.js";
import { ControlEventApplier } from "./internal/ControlEventApplier.js";
import { TickOrchestrator } from "./internal/TickOrchestrator.js";
import { WorldLifecycle } from "./internal/WorldLifecycle.js";
import type {
  TickHandler,
  WorldEngineRuntime,
} from "./internal/WorldEngineRuntime.js";
import { AgentRegistry } from "../agents/AgentRegistry.js";
import { MessageBus } from "../messaging/MessageBus.js";
import { PluginRegistry } from "../plugins/PluginRegistry.js";
import { LLMAdapterPool } from "../llm/LLMAdapterPool.js";
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
import type { AgentConfig, AgentStatus } from "../types/AgentTypes.js";
import type { WorldSimPlugin } from "../types/PluginTypes.js";
import type { BaseAgent } from "../agents/BaseAgent.js";
import type { ConsolidationResult } from "../types/ConsolidationTypes.js";

export class WorldEngine {
  private runtime: WorldEngineRuntime;
  private bootstrapper: WorldBootstrapper;
  private lifecycle: WorldLifecycle;
  private tickOrchestrator: TickOrchestrator;

  constructor(config: WorldConfig) {
    this.runtime = {
      status: "idle",
      config,
      context: createWorldContext(config.worldId ?? randomUUID()),
      agentRegistry: new AgentRegistry(),
      messageBus: new MessageBus(),
      rulesContext: null,
      pluginRegistry: new PluginRegistry(),
      llmPool: new LLMAdapterPool(
        config.llm,
        config.lightLlm,
        config.enableResponseCache ?? false,
        config.responseCacheTtl ?? 5,
      ),
      clock: new WorldClock(),
      controlAgents: [],
      personAgents: [],
      eventLog: new CircularBuffer(config.eventLogMaxSize ?? 10_000),
      pendingAgentConfigs: [],
      tickHandlers: [],
      brainMemory: undefined,
      batchExecutor: new BatchExecutor(config.maxConcurrentAgents),
      activityScheduler: new ActivityScheduler(),
      tokenBudgetTracker: new TokenBudgetTracker(),
      neighborhoodManager: new NeighborhoodManager(),
      conversationManager: new ConversationManager(),
      locationIndex: new LocationIndex(),
    };

    this.bootstrapper = new WorldBootstrapper(this.runtime);
    this.lifecycle = new WorldLifecycle(this.runtime);
    const controlEventApplier = new ControlEventApplier(
      this.runtime,
      this.logEvent.bind(this),
    );
    this.tickOrchestrator = new TickOrchestrator(
      this.runtime,
      controlEventApplier,
      this.logEvent.bind(this),
    );
  }

  use(plugin: WorldSimPlugin): this {
    this.runtime.pluginRegistry.register(plugin);
    return this;
  }

  addAgent(config: AgentConfig): this {
    this.runtime.pendingAgentConfigs.push(config);
    return this;
  }

  on(event: "tick", handler: TickHandler): this {
    if (event === "tick") {
      this.runtime.tickHandlers.push(handler);
    }
    return this;
  }

  async start(): Promise<void> {
    this.runtime.status = "bootstrapping";
    await this.bootstrapper.bootstrap();
    this.lifecycle.markRunning();
    await this.tickOrchestrator.runLoop();
  }

  async stop(): Promise<void> {
    await this.lifecycle.stop();
  }

  async pause(): Promise<void> {
    this.lifecycle.pause();
  }

  async resume(): Promise<void> {
    if (this.lifecycle.canResume()) {
      this.lifecycle.markRunning();
      await this.tickOrchestrator.runLoop();
    }
  }

  agent(id: string): BaseAgent {
    return this.runtime.agentRegistry.getOrThrow(id);
  }

  pauseAgent(id: string, reason?: string): this {
    const a = this.agent(id);
    const oldStatus = a.status;
    a.pause(this.runtime.clock.current(), "host");

    this.logEvent("agent:paused", id, { reason });
    this.runtime.pluginRegistry.runHook(
      "onAgentStatusChange",
      {
        type: "agent:pause",
        agentId: id,
        requestedBy: "host",
        tick: this.runtime.clock.current(),
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
    a.resume(this.runtime.clock.current(), "host");

    this.logEvent("agent:resumed", id, {});
    this.runtime.pluginRegistry.runHook(
      "onAgentStatusChange",
      {
        type: "agent:resume",
        agentId: id,
        requestedBy: "host",
        tick: this.runtime.clock.current(),
      },
      oldStatus,
      a.status,
    );

    return this;
  }

  stopAgent(id: string, reason?: string): this {
    const a = this.agent(id);
    const oldStatus = a.status;
    a.stop(this.runtime.clock.current(), "host");

    this.runtime.agentRegistry.remove(id);
    this.runtime.personAgents = this.runtime.personAgents.filter((p) => p.id !== id);
    this.runtime.controlAgents = this.runtime.controlAgents.filter((c) => c.id !== id);

    this.logEvent("agent:stopped", id, { reason });
    this.runtime.pluginRegistry.runHook(
      "onAgentStatusChange",
      {
        type: "agent:stop",
        agentId: id,
        requestedBy: "host",
        tick: this.runtime.clock.current(),
        reason,
      },
      oldStatus,
      "stopped",
    );

    return this;
  }

  getAgentStatuses(): Record<string, AgentStatus> {
    const result: Record<string, AgentStatus> = {};
    for (const agent of this.runtime.agentRegistry.list()) {
      result[agent.id] = agent.status;
    }
    return result;
  }

  getStatus(): WorldStatus {
    return this.runtime.status;
  }

  getContext(): Readonly<WorldContext> {
    return this.runtime.context;
  }

  getEventLog(): Readonly<WorldEvent[]> {
    return this.runtime.eventLog.toArray();
  }

  getAgent(id: string): BaseAgent | undefined {
    return this.runtime.agentRegistry.get(id);
  }

  async consolidate(): Promise<ConsolidationResult[]> {
    if (!this.runtime.brainMemory) return [];
    const results: ConsolidationResult[] = [];
    const worldId = this.runtime.context.worldId;
    for (const agent of this.runtime.agentRegistry.list()) {
      const result = await this.runtime.brainMemory.consolidate(agent.id, worldId);
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
    return this.runtime.conversationManager.startConversation(
      initiatorId,
      participantIds,
      topic,
      this.runtime.clock.current(),
    );
  }

  /**
   * Ends an active conversation.
   */
  endConversation(conversationId: string): void {
    this.runtime.conversationManager.endConversation(conversationId);
  }

  /**
   * Returns the location index for spatial queries.
   */
  getLocationIndex(): LocationIndex {
    return this.runtime.locationIndex;
  }

  /**
   * Returns the neighborhood manager.
   */
  getNeighborhoodManager(): NeighborhoodManager {
    return this.runtime.neighborhoodManager;
  }

  /**
   * Returns the conversation manager.
   */
  getConversationManager(): ConversationManager {
    return this.runtime.conversationManager;
  }

  private logEvent(
    type: string,
    agentId: string,
    payload: unknown,
  ): void {
    this.runtime.eventLog.push({
      type,
      tick: this.runtime.clock.current(),
      agentId,
      payload,
      timestamp: new Date(),
    });
  }
}
