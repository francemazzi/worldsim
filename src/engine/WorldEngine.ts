import { randomUUID } from "node:crypto";
import { WorldClock } from "./WorldClock.js";
import { createWorldContext } from "./WorldContext.js";
import { BatchExecutor } from "./BatchExecutor.js";
import { CircularBuffer } from "./CircularBuffer.js";
import { IntraTickTimeline } from "./IntraTickTimeline.js";
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
import { McpClientManager } from "../mcp/McpClientManager.js";
import { privacyCompliancePlugin } from "../plugins/built-in/PrivacyCompliancePlugin.js";
import { FederationPlugin } from "../plugins/built-in/FederationPlugin.js";
import { isPositionProvider } from "../plugins/capabilities/PositionProvider.js";
import { FederationBus } from "../federation/FederationBus.js";
import type { Conversation } from "../types/ConversationTypes.js";
import type {
  WorldConfig,
  WorldContext,
  WorldStatus,
  WorldEvent,
} from "../types/WorldTypes.js";
import type { AgentConfig, AgentStatus } from "../types/AgentTypes.js";
import type { WorldSimPlugin } from "../types/PluginTypes.js";
import type { RulesContext } from "../types/RulesTypes.js";
import type { BaseAgent } from "../agents/BaseAgent.js";
import type { ConsolidationResult } from "../types/ConsolidationTypes.js";
import type { TokenUsage } from "../types/ScheduleTypes.js";
import type { TimelineMetadata } from "../types/TimelineTypes.js";

export class WorldEngine {
  private runtime: WorldEngineRuntime;
  private bootstrapper: WorldBootstrapper;
  private lifecycle: WorldLifecycle;
  private tickOrchestrator: TickOrchestrator;

  constructor(config: WorldConfig) {
    const timeline = new IntraTickTimeline();
    this.runtime = {
      status: "idle",
      config,
      context: createWorldContext(config.worldId ?? randomUUID()),
      agentRegistry: new AgentRegistry(),
      messageBus: new MessageBus(timeline),
      timeline,
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
      mcpClientManager: new McpClientManager(),
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

    if (config.privacy) {
      this.runtime.pluginRegistry.register(
        privacyCompliancePlugin({
          privacyConfig: config.privacy,
          persistenceStore: config.persistenceStore,
        }),
      );
    }

    if (config.federation) {
      // Reuse the worldId declared on the federation node so MessageBus
      // routing and the local context agree.
      this.runtime.context.worldId = config.federation.worldNode.worldId;
      this.runtime.federationBus = new FederationBus({
        worldNode: config.federation.worldNode,
        transport: config.federation.transport,
        messageBus: this.runtime.messageBus,
        pluginRegistry: this.runtime.pluginRegistry,
        getCurrentTick: () => this.runtime.clock.current(),
        hasLocalAgent: (agentId) => this.runtime.agentRegistry.get(agentId) !== undefined,
      });
      this.runtime.pluginRegistry.register(
        new FederationPlugin({
          worldId: config.federation.worldNode.worldId,
          messageBus: this.runtime.messageBus,
        }),
      );
    }
  }

  /** Returns the FederationBus when the world is part of a federation. */
  getFederationBus(): FederationBus | undefined {
    return this.runtime.federationBus;
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

    const metadata = this.runtime.timeline.nextEvent();
    this.logEvent("agent:paused", id, { reason }, metadata);
    this.runtime.pluginRegistry.runHook(
      "onAgentStatusChange",
      {
        type: "agent:pause",
        agentId: id,
        requestedBy: "host",
        tick: this.runtime.clock.current(),
        reason,
        metadata,
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

    const metadata = this.runtime.timeline.nextEvent();
    this.logEvent("agent:resumed", id, {}, metadata);
    this.runtime.pluginRegistry.runHook(
      "onAgentStatusChange",
      {
        type: "agent:resume",
        agentId: id,
        requestedBy: "host",
        tick: this.runtime.clock.current(),
        metadata,
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

    const metadata = this.runtime.timeline.nextEvent();
    this.logEvent("agent:stopped", id, { reason }, metadata);
    this.runtime.pluginRegistry.runHook(
      "onAgentStatusChange",
      {
        type: "agent:stop",
        agentId: id,
        requestedBy: "host",
        tick: this.runtime.clock.current(),
        reason,
        metadata,
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

  /**
   * Push a real-world GPS position for an agent.
   * If any registered plugin exposes the {@link PositionProvider} capability
   * (e.g. MovementPlugin), delegates to it so history + events are recorded.
   * Otherwise falls back to updating the LocationIndex directly.
   */
  updateAgentPosition(agentId: string, latitude: number, longitude: number, label?: string): this {
    const provider = this.runtime.pluginRegistry.getCapability(isPositionProvider);

    if (provider) {
      provider.updateRealPosition(agentId, latitude, longitude, label);
    } else {
      this.runtime.locationIndex.update(agentId, { latitude, longitude, label });
    }
    return this;
  }

  getStatus(): WorldStatus {
    return this.runtime.status;
  }

  getContext(): Readonly<WorldContext> {
    return this.runtime.context;
  }

  getConfig(): Readonly<WorldConfig> {
    return this.runtime.config;
  }

  getEventLog(): Readonly<WorldEvent[]> {
    return this.runtime.eventLog.toArray();
  }

  getAgent(id: string): BaseAgent | undefined {
    return this.runtime.agentRegistry.get(id);
  }

  getPlugin(name: string): WorldSimPlugin | undefined {
    return this.runtime.pluginRegistry.getPlugin(name);
  }

  getRulesContext(): RulesContext | null {
    return this.runtime.rulesContext;
  }

  getBrainMemory(): import("../memory/BrainMemory.js").BrainMemory | undefined {
    return this.runtime.brainMemory;
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

  /**
   * Returns the message bus. Useful when registering plugins (e.g. PhonePlugin)
   * that need to publish messages outside the normal agent tick.
   */
  getMessageBus(): MessageBus {
    return this.runtime.messageBus;
  }

  getTokenUsage(agentId: string): TokenUsage | undefined {
    return this.runtime.tokenBudgetTracker.getUsage(agentId);
  }

  getAllTokenUsage(): Record<string, TokenUsage> {
    const usage: Record<string, TokenUsage> = {};
    for (const agent of this.runtime.agentRegistry.list()) {
      const tracked = this.runtime.tokenBudgetTracker.getUsage(agent.id);
      if (tracked) usage[agent.id] = tracked;
    }
    return usage;
  }

  private logEvent(
    type: string,
    agentId: string,
    payload: unknown,
    metadata?: TimelineMetadata,
  ): void {
    this.runtime.eventLog.push({
      type,
      tick: this.runtime.clock.current(),
      agentId,
      payload,
      timestamp: new Date(),
      metadata: metadata ?? this.runtime.timeline.nextEvent(),
    });
  }
}
