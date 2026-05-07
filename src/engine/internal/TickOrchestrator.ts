import type { AgentAction } from "../../types/AgentTypes.js";
import type { WorldEngineRuntime } from "./WorldEngineRuntime.js";
import { ControlEventApplier } from "./ControlEventApplier.js";
import type { TimelineMetadata } from "../../types/TimelineTypes.js";
import { createStimulusId } from "../../perception/StimulusBus.js";
import type { Stimulus } from "../../types/StimulusTypes.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TickOrchestrator {
  constructor(
    private runtime: WorldEngineRuntime,
    private controlEventApplier: ControlEventApplier,
    private logEvent: (type: string, agentId: string, payload: unknown, metadata?: TimelineMetadata) => void,
  ) {}

  async runLoop(): Promise<void> {
    const maxTicks = this.runtime.config.maxTicks ?? Infinity;
    const interval = this.runtime.config.tickIntervalMs ?? 0;

    while (
      this.runtime.status === "running"
      && this.runtime.clock.current() < maxTicks
    ) {
      await this.executeTick();
      if (interval > 0) await sleep(interval);
    }

    if (this.runtime.status === "running") {
      this.runtime.status = "stopped";
      await this.runtime.pluginRegistry.runHook(
        "onWorldStop",
        this.runtime.context,
        this.runtime.eventLog.toArray(),
      );
    }
  }

  async executeTick(): Promise<void> {
    const tick = this.runtime.clock.increment();
    this.runtime.messageBus.newTick(tick);
    this.runtime.stimulusBus.newTick(tick);
    this.runtime.context.tickCount = tick;
    this.runtime.llmPool.setTick(tick);

    // Federation: drain inbound envelopes BEFORE plugin/tick hooks so any
    // arriving messages are visible to active agents during this tick.
    if (this.runtime.federationBus) {
      await this.runtime.federationBus.drainInbound(tick);
    }

    // Realistic Simulation: emit entity background stimuli (smell, ambient
    // sound, signal sources). Stimuli emitted here are visible to all
    // perceivers from this tick onward.
    if (this.runtime.perceptionEnabled) {
      this.emitEntityStimuli(tick);
    }

    await this.runtime.pluginRegistry.runHook(
      "onWorldTick",
      tick,
      this.runtime.context,
    );

    for (const handler of this.runtime.tickHandlers) {
      try {
        handler(tick);
      } catch {
        // ignore tick handler errors
      }
    }

    // Reset per-tick token counters
    this.runtime.tokenBudgetTracker.resetAllTicks(tick);

    // Cleanup stale conversations
    this.runtime.conversationManager.tickCleanup(tick);

    // Reset neighborhood cache for this tick
    this.runtime.neighborhoodManager.resetTickCache(tick);

    // Filter active agents, applying world-level active-set scheduling
    const defaultRatio = this.runtime.config.defaultActiveTickRatio;
    const perceptionEnabled = this.runtime.perceptionEnabled;
    const activePersonAgents = this.runtime.personAgents
      .filter((a) => {
        if (!a.isActive) return false;

        // Agents with pending messages always run (they have stimulus)
        if (this.runtime.messageBus.getMessageCount(a.id, tick) > 0) return true;

        // In perception mode, agents that perceive something (anything)
        // bypass the activity ratio gate so reactions are not silently
        // dropped. Salience-based filtering happens later in the agent.
        if (perceptionEnabled) {
          const percepts = this.runtime.perceptionEngine.perceiveFor(
            a.id,
            this.runtime.stimulusBus,
            tick,
          );
          if (percepts.length > 0) return true;
        }

        // Apply world-level defaultActiveTickRatio for agents without their own schedule
        if (defaultRatio != null && defaultRatio < 1.0) {
          if (!this.runtime.activityScheduler.shouldActivate(a.id, tick, {
            activeTickRatio: defaultRatio,
          })) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const aMsgs = this.runtime.messageBus.getMessageCount(a.id, tick);
        const bMsgs = this.runtime.messageBus.getMessageCount(b.id, tick);
        return bMsgs - aMsgs; // More messages = higher priority
      });

    const allActions: AgentAction[] = [];

    // Execute agents through batch executor with concurrency limit
    const tasks = activePersonAgents.map((agent) => {
      return async () => {
        const actions = await agent.tick(
          this.runtime.context,
          this.runtime.rulesContext!,
        );
        return actions;
      };
    });

    const results = await this.runtime.batchExecutor.executeSettled(tasks);
    for (const result of results) {
      if (result.status === "fulfilled") {
        allActions.push(...result.value);
      } else {
        const agent = activePersonAgents[result.index];
        this.logEvent("agent:error", agent?.id ?? "unknown", {
          error: result.error.message,
        });
      }
    }

    const transformedActions: AgentAction[] = [];
    for (const action of allActions) {
      const transformed = await this.runtime.pluginRegistry.runHookWithTransform(
        "onAgentAction",
        action,
        {
          agentId: action.agentId,
          status: "running",
          currentMessages: [],
          loopCount: 0,
          ephemeralMemory: { worldId: this.runtime.context.worldId },
        },
      ) as AgentAction;
      transformedActions.push(transformed);
    }

    // Realistic Simulation: feed every speech stimulus from this tick into
    // the topic tracker so subsequent ticks can frame replies as part of
    // the same thread.
    if (this.runtime.perceptionEnabled) {
      for (const stim of this.runtime.stimulusBus.getForTick(tick)) {
        this.runtime.topicTracker.ingest(stim);
      }
      // Tick the needs tracker for every active agent (decay/regen).
      for (const agent of activePersonAgents) {
        this.runtime.needsTracker.tick(agent.id);
      }
    }

    // Batch decay/prune relationships for all active agents (single pass)
    if (this.runtime.config.graphStore) {
      const agentIds = activePersonAgents.map((a) => a.id);
      await this.runtime.neighborhoodManager.decayAndPruneBatch(
        agentIds,
        tick,
        this.runtime.config.graphStore,
      );
    }

    this.controlEventApplier.apply(tick);

    if (this.runtime.controlAgents.length > 0 && transformedActions.length > 0) {
      for (const ca of this.runtime.controlAgents) {
        if (!ca.isActive) continue;
        const evaluations = await ca.evaluateActions(
          transformedActions,
          this.runtime.context,
          this.runtime.rulesContext!,
          this.runtime.config.controlSamplingRate,
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
      for (const action of transformedActions) {
        this.logEvent("action:executed", action.agentId, {
          actionType: action.actionType,
          payload: action.payload,
        }, action.metadata);
      }
    }

    await this.runtime.pluginRegistry.runActionHooks(
      transformedActions,
      this.runtime.context,
      (action) => ({
        agentId: action.agentId,
        status: "running",
        currentMessages: [],
        loopCount: 0,
        ephemeralMemory: { worldId: this.runtime.context.worldId },
      }),
      { skipPerAction: true },
    );

    for (const ca of this.runtime.controlAgents) {
      if (ca.isActive) {
        await ca.tick(this.runtime.context, this.runtime.rulesContext!);
      }
    }
  }

  /**
   * Walks the entity registry and publishes a stimulus per declared,
   * enabled emitter that fires on the current tick. Cheap when no
   * entities have emitters.
   */
  private emitEntityStimuli(tick: number): void {
    for (const entity of this.runtime.entityRegistry.values()) {
      if (!entity.emitters || entity.emitters.length === 0) continue;
      for (const emitter of entity.emitters) {
        if (emitter.enabled === false) continue;
        const period = emitter.everyNTicks ?? 1;
        if (period <= 0) continue;
        if (tick % period !== 0) continue;
        const stim: Stimulus = {
          id: createStimulusId(),
          kind: emitter.kind,
          channel: emitter.channel,
          source: { kind: "entity", id: entity.id },
          tick,
          intensity: emitter.intensity ?? 0.5,
          payload: emitter.payload ?? {},
          ...(emitter.rangeKm != null ? { rangeKm: emitter.rangeKm } : {}),
          ...(entity.position ? { position: entity.position } : {}),
        };
        this.runtime.stimulusBus.publish(stim);
      }
    }
  }
}
