import type { WorldSimPlugin } from "../../types/PluginTypes.js";
import type { AgentAction, AgentControlEvent, AgentStatus } from "../../types/AgentTypes.js";
import type { WorldContext, WorldEvent } from "../../types/WorldTypes.js";
import type { RulesContext } from "../../types/RulesTypes.js";
import type { WorldEngine } from "../../engine/WorldEngine.js";
import type {
  SimulationReport,
  AgentReport,
  AgentTickSnapshot,
  ActionDistribution,
  TimelineEntry,
  RelationshipEvolution,
  RelationshipSnapshot,
  SimulationMetrics,
  AgentNode,
} from "../../types/ReportTypes.js";
import type { TokenPriceConfig } from "../../types/PrivacyTypes.js";
import type { GraphStore, Relationship } from "../../types/GraphTypes.js";
import { analyzeNetwork } from "../../analysis/NetworkAnalyzer.js";
import { analyzeDialogue } from "../../analysis/DialogueAnalyzer.js";
import { analyzeShock } from "../../analysis/ShockAnalyzer.js";
import { analyzeArchetypes } from "../../analysis/ArchetypeAnalyzer.js";
import {
  compareAgentActionsByTimeline,
  compareTimelineMetadata,
} from "../../engine/IntraTickTimeline.js";

export interface ReportGeneratorOptions {
  engine: WorldEngine;
  /** Maximum timeline entries to keep. Default 500. */
  maxTimelineEntries?: number | undefined;
  /** Interval in ticks between graph snapshots (default 5). */
  graphSnapshotEveryTicks?: number | undefined;
  /** Window size (in ticks) used by the shock analyzer. Default 5. */
  shockWindowTicks?: number | undefined;
}

interface AgentCollector {
  agentId: string;
  name: string;
  role: string;
  personality: string[];
  profession?: string | undefined;
  actions: ActionDistribution;
  totalActions: number;
  moodTrajectory: AgentTickSnapshot[];
  energyTrajectory: AgentTickSnapshot[];
  statusChanges: { tick: number; from: string; to: string; reason?: string }[];
}

interface GraphSnapshot {
  tick: number;
  relationships: Relationship[];
}

interface PolicyTrigger {
  tick: number;
  description?: string | undefined;
}

/**
 * Creates a ReportGeneratorPlugin that collects simulation data and produces
 * a SimulationReport when the world stops.
 */
export function reportGeneratorPlugin(options: ReportGeneratorOptions) {
  const maxTimeline = options.maxTimelineEntries ?? 500;
  const snapshotInterval = options.graphSnapshotEveryTicks ?? 5;
  const shockWindow = options.shockWindowTicks ?? 5;

  let report: SimulationReport | null = null;
  let startTime = 0;
  const timeline: TimelineEntry[] = [];
  const allActions: AgentAction[] = [];
  const collectors = new Map<string, AgentCollector>();
  let totalEvents = 0;
  const graphSnapshots: GraphSnapshot[] = [];
  const violationsByTick = new Map<number, number>();
  let policyTrigger: PolicyTrigger | null = null;
  let cumulativeTotalStimuli = 0;
  const cumulativeStimuliByKind: Record<string, number> = {};
  const cumulativeStimuliByChannel: Record<string, number> = {};

  function ensureCollector(agentId: string): AgentCollector {
    let c = collectors.get(agentId);
    if (!c) {
      const agent = options.engine.getAgent(agentId);
      const profile = agent?.getProfile();
      c = {
        agentId,
        name: profile?.name ?? agentId,
        role: agent?.role ?? "person",
        personality: profile?.personality ?? [],
        profession: (profile as unknown as { profession?: string } | undefined)?.profession,
        actions: { speak: 0, observe: 0, interact: 0, tool_call: 0, finish: 0, perceive: 0 },
        totalActions: 0,
        moodTrajectory: [],
        energyTrajectory: [],
        statusChanges: [],
      };
      collectors.set(agentId, c);
    }
    return c;
  }

  function addTimeline(entry: TimelineEntry): void {
    if (timeline.length < maxTimeline) {
      timeline.push(entry);
    }
  }

  function snapshotAgents(tick: number): void {
    const statuses = options.engine.getAgentStatuses();
    for (const id of Object.keys(statuses)) {
      const agent = options.engine.getAgent(id);
      if (!agent) continue;
      const state = agent.getInternalState();
      const c = ensureCollector(id);
      const snap: AgentTickSnapshot = { tick, mood: state.mood, energy: state.energy };
      c.moodTrajectory.push(snap);
      c.energyTrajectory.push(snap);
    }
  }

  async function captureGraphSnapshot(tick: number): Promise<void> {
    const graphStore = options.engine.getConfig().graphStore;
    if (!graphStore) return;
    const rels = await dumpAllRelationships(graphStore, [...collectors.keys()]);
    graphSnapshots.push({ tick, relationships: rels });
  }

  function countViolationsFromEvents(events: WorldEvent[]): number {
    let count = 0;
    for (const ev of events) {
      if (!isViolationEvent(ev.type)) continue;
      count++;
      violationsByTick.set(ev.tick, (violationsByTick.get(ev.tick) ?? 0) + 1);
      const payload = ev.payload as { reason?: string; suggestion?: string } | undefined;
      addTimeline({
        tick: ev.tick,
        type: "rule_violation",
        agentId: ev.agentId,
        description: `${ev.agentId ?? "unknown"}: ${ev.type} — ${payload?.reason ?? payload?.suggestion ?? ""}`,
        data: { eventType: ev.type, ...(payload ?? {}) },
      });
    }
    return count;
  }

  function buildReport(ctx: WorldContext, events: WorldEvent[]): SimulationReport {
    const stopTime = Date.now();
    totalEvents = events.length;

    violationsByTick.clear();
    const ruleViolations = countViolationsFromEvents(events);

    const pricing: TokenPriceConfig | undefined = options.engine.getConfig().observability?.pricing;
    const agentReports: AgentReport[] = [];
    let aggregateLatencyMs = 0;
    let aggregateRequests = 0;
    let aggregateCost = 0;
    let aggregateTokens = 0;
    for (const c of collectors.values()) {
      const usage = options.engine.getTokenUsage(c.agentId);
      const inputTokens = usage?.lifetimeTokens ?? 0;
      const outputTokens = 0;
      const estimatedCost = estimateCost(inputTokens, outputTokens, pricing);
      const avgLatencyMs =
        usage && usage.lifetimeRequests > 0
          ? Math.round((usage.totalLatencyMs / usage.lifetimeRequests) * 10) / 10
          : 0;
      aggregateLatencyMs += usage?.totalLatencyMs ?? 0;
      aggregateRequests += usage?.lifetimeRequests ?? 0;
      aggregateCost += estimatedCost;
      aggregateTokens += usage?.lifetimeTokens ?? 0;
      agentReports.push({
        agentId: c.agentId,
        name: c.name,
        role: c.role,
        personality: c.personality,
        actions: { ...c.actions },
        totalActions: c.totalActions,
        moodTrajectory: [...c.moodTrajectory],
        energyTrajectory: [...c.energyTrajectory],
        statusChanges: [...c.statusChanges],
        observability: {
          tokenUsage: {
            tickTokens: usage?.tickTokens ?? 0,
            hourTokens: usage?.hourTokens ?? 0,
            lifetimeTokens: usage?.lifetimeTokens ?? 0,
            tickRequests: usage?.tickRequests ?? 0,
            hourRequests: usage?.hourRequests ?? 0,
            lifetimeRequests: usage?.lifetimeRequests ?? 0,
          },
          latency: {
            avgMs: avgLatencyMs,
            lastMs: usage?.lastLatencyMs ?? 0,
            maxMs: usage?.maxLatencyMs ?? 0,
          },
          cost: {
            estimated: Math.round(estimatedCost * 10000) / 10000,
            currency: pricing?.currency ?? "USD",
          },
        },
      });
    }

    const relationships = buildRelationshipEvolutions(graphSnapshots);

    const totalSpeaks = agentReports.reduce((s, a) => s + a.actions.speak, 0);
    const totalObservations = agentReports.reduce((s, a) => s + a.actions.observe, 0);
    const totalToolCalls = agentReports.reduce((s, a) => s + a.actions.tool_call, 0);
    const totalInteractions = agentReports.reduce((s, a) => s + a.actions.interact, 0);
    const statusChanges = agentReports.reduce((s, a) => s + a.statusChanges.length, 0);

    const tickMap = new Map<number, { moods: string[]; energies: number[] }>();
    for (const a of agentReports) {
      for (const snap of a.moodTrajectory) {
        let entry = tickMap.get(snap.tick);
        if (!entry) {
          entry = { moods: [], energies: [] };
          tickMap.set(snap.tick, entry);
        }
        entry.moods.push(snap.mood);
        entry.energies.push(snap.energy);
      }
    }
    const averageMoodByTick: { tick: number; avgMood: string }[] = [];
    const averageEnergyByTick: { tick: number; avgEnergy: number }[] = [];
    for (const [tick, data] of [...tickMap.entries()].sort((a, b) => a[0] - b[0])) {
      const moodCounts = new Map<string, number>();
      for (const m of data.moods) moodCounts.set(m, (moodCounts.get(m) ?? 0) + 1);
      let topMood = "neutral";
      let topCount = 0;
      for (const [mood, count] of moodCounts) {
        if (count > topCount) {
          topMood = mood;
          topCount = count;
        }
      }
      averageMoodByTick.push({ tick, avgMood: topMood });
      const avgEnergy = data.energies.reduce((s, e) => s + e, 0) / data.energies.length;
      averageEnergyByTick.push({ tick, avgEnergy: Math.round(avgEnergy * 10) / 10 });
    }

    const metrics: SimulationMetrics = {
      totalInteractions,
      totalSpeaks,
      totalObservations,
      totalToolCalls,
      ruleViolations,
      statusChanges,
      totalTokens: aggregateTokens,
      avgLatencyMs:
        aggregateRequests > 0
          ? Math.round((aggregateLatencyMs / aggregateRequests) * 10) / 10
          : 0,
      estimatedCost: {
        amount: Math.round(aggregateCost * 10000) / 10000,
        currency: pricing?.currency ?? "USD",
      },
      averageMoodByTick,
      averageEnergyByTick,
    };

    const perceptionMetrics = computePerceptionMetrics(options.engine, {
      cumulativeTotalStimuli,
      cumulativeStimuliByKind: { ...cumulativeStimuliByKind },
      cumulativeStimuliByChannel: { ...cumulativeStimuliByChannel },
    });
    if (perceptionMetrics) metrics.perception = perceptionMetrics;

    const baseReport: SimulationReport = {
      summary: {
        worldId: ctx.worldId,
        totalTicks: ctx.tickCount,
        agentCount: agentReports.length,
        totalEvents,
        totalActions: allActions.length,
        durationMs: stopTime - startTime,
        startedAt: ctx.startedAt.toISOString(),
        stoppedAt: new Date(stopTime).toISOString(),
      },
      timeline: [...timeline].sort(compareTimelineEntries),
      agents: agentReports,
      relationships,
      metrics,
      rawActions: [...allActions].sort(compareAgentActionsByTimeline),
    };

    const nodes = buildAgentNodes(agentReports, collectors);
    const finalGraph =
      graphSnapshots.length > 0 ? graphSnapshots[graphSnapshots.length - 1]!.relationships : [];
    const initialGraph = graphSnapshots.length > 0 ? graphSnapshots[0]!.relationships : [];

    if (finalGraph.length > 0 || nodes.length > 0) {
      baseReport.network = analyzeNetwork({
        finalRelationships: finalGraph,
        initialRelationships: initialGraph,
        snapshotsByTick: graphSnapshots,
        nodes,
      });
    }

    const conversations = options.engine.getConversationManager().getAll();
    const personAgents = agentReports.filter((a) => a.role !== "control");
    if (totalSpeaks > 0 || conversations.length > 0) {
      baseReport.dialogue = analyzeDialogue({
        rawActions: [...allActions].sort(compareAgentActionsByTimeline),
        conversations,
        agentIds: personAgents.map((a) => a.agentId),
      });
    }

    if (policyTrigger) {
      baseReport.shock = analyzeShock({
        triggerTick: policyTrigger.tick,
        description: policyTrigger.description,
        windowTicks: shockWindow,
        rawActions: allActions,
        agents: agentReports,
        violationsByTick,
        totalTicks: ctx.tickCount,
      });
    } else {
      baseReport.shock = null;
    }

    if (personAgents.length > 0) {
      baseReport.archetypes = analyzeArchetypes({
        agents: agentReports,
        rawActions: allActions,
        graphSnapshotsByTick: graphSnapshots,
        violationsByTick,
        totalTicks: ctx.tickCount,
        ...(policyTrigger ? { triggerTick: policyTrigger.tick } : {}),
      });
    }

    // Narrative remains opt-in; populated lazily by the API.
    baseReport.narrative = null;

    return baseReport;
  }

  const plugin: WorldSimPlugin = {
    name: "report-generator",
    version: "1.1.0",
    parallel: true,

    async onBootstrap(_ctx: WorldContext, _rules: RulesContext): Promise<void> {
      startTime = Date.now();
      report = null;
      timeline.length = 0;
      allActions.length = 0;
      collectors.clear();
      totalEvents = 0;
      graphSnapshots.length = 0;
      violationsByTick.clear();
      policyTrigger = null;
      cumulativeTotalStimuli = 0;
      Object.keys(cumulativeStimuliByKind).forEach((k) => delete cumulativeStimuliByKind[k]);
      Object.keys(cumulativeStimuliByChannel).forEach((k) => delete cumulativeStimuliByChannel[k]);

      const statuses = options.engine.getAgentStatuses();
      for (const id of Object.keys(statuses)) {
        ensureCollector(id);
      }
    },

    async onWorldTick(tick: number, _ctx: WorldContext): Promise<void> {
      snapshotAgents(tick);
      const stimuli = options.engine.getStimulusBus().getForTick(tick);
      for (const s of stimuli) {
        cumulativeTotalStimuli += 1;
        cumulativeStimuliByKind[s.kind] = (cumulativeStimuliByKind[s.kind] ?? 0) + 1;
        cumulativeStimuliByChannel[s.channel] = (cumulativeStimuliByChannel[s.channel] ?? 0) + 1;
      }
      if (tick === 1 || tick % snapshotInterval === 0) {
        await captureGraphSnapshot(tick);
      }
    },

    async onAgentAction(action: AgentAction): Promise<AgentAction> {
      allActions.push(action);
      const c = ensureCollector(action.agentId);
      c.totalActions++;
      const aType = action.actionType as keyof ActionDistribution;
      if (aType in c.actions) {
        c.actions[aType]++;
      }

      if (action.actionType === "speak") {
        const payload = action.payload as { content?: string } | undefined;
        addTimeline({
          tick: action.tick,
          type: "action",
          agentId: action.agentId,
          description: `${c.name}: ${typeof payload?.content === "string" ? payload.content.slice(0, 120) : "spoke"}`,
          ...(action.metadata ? { metadata: action.metadata } : {}),
        });
      }

      return action;
    },

    async onAgentStatusChange(
      event: AgentControlEvent,
      oldStatus: AgentStatus,
      newStatus: AgentStatus,
    ): Promise<void> {
      const c = ensureCollector(event.agentId);
      c.statusChanges.push({
        tick: event.tick,
        from: oldStatus,
        to: newStatus,
        ...(event.reason != null ? { reason: event.reason } : {}),
      });

      addTimeline({
        tick: event.tick,
        type: "status_change",
        agentId: event.agentId,
        description: `${c.name}: ${oldStatus} -> ${newStatus}${event.reason ? ` (${event.reason})` : ""}`,
      });
    },

    async onWorldStop(ctx: WorldContext, events: WorldEvent[]): Promise<void> {
      await captureGraphSnapshot(ctx.tickCount);
      report = buildReport(ctx, events);
    },
  };

  return {
    plugin,
    /** Returns the final report after stop, or a live partial report while running. */
    getReport(): SimulationReport | null {
      if (report) return report;
      if (startTime === 0 || collectors.size === 0) return null;
      const ctx = options.engine.getContext();
      const events = [...options.engine.getEventLog()];
      return buildReport(ctx, events);
    },
    /**
     * Records a policy trigger event that downstream analyzers can use to
     * build the pre/post shock comparison. Multiple calls overwrite the
     * previous trigger (only the most recent is analyzed).
     */
    recordPolicyTrigger(tick: number, description?: string): void {
      policyTrigger = { tick, description };
      addTimeline({
        tick,
        type: "policy_trigger",
        description: description ?? `Policy trigger at tick ${tick}`,
        data: { description },
      });
    },
  };
}

function compareTimelineEntries(a: TimelineEntry, b: TimelineEntry): number {
  const tickDiff = a.tick - b.tick;
  if (tickDiff !== 0) return tickDiff;

  const temporal = compareTimelineMetadata(a.metadata, b.metadata);
  if (temporal !== 0) return temporal;

  return a.description.localeCompare(b.description);
}

function estimateCost(
  inputTokens: number,
  outputTokens: number,
  pricing?: TokenPriceConfig,
): number {
  if (!pricing) return 0;
  const inputCost = ((pricing.inputPer1k ?? 0) * inputTokens) / 1000;
  const outputCost = ((pricing.outputPer1k ?? 0) * outputTokens) / 1000;
  return inputCost + outputCost;
}

function isViolationEvent(type: string): boolean {
  return (
    type === "action:blocked"
    || type === "action:warned"
    || type === "rule:violation"
  );
}

/**
 * Since GraphStore only exposes per-agent queries, we dump the full graph
 * by querying each known agent and deduping edges by (from, to, type).
 */
async function dumpAllRelationships(
  store: GraphStore,
  agentIds: string[],
): Promise<Relationship[]> {
  const seen = new Map<string, Relationship>();
  for (const id of agentIds) {
    try {
      const rels = await store.getRelationships({ agentId: id });
      for (const r of rels) {
        seen.set(`${r.from}|${r.to}|${r.type}`, r);
      }
    } catch {
      // Ignore store errors on individual agents.
    }
  }
  return [...seen.values()];
}

function buildRelationshipEvolutions(
  snapshots: GraphSnapshot[],
): RelationshipEvolution[] {
  if (snapshots.length === 0) return [];
  const byKey = new Map<string, { first: Relationship; last: Relationship; snaps: RelationshipSnapshot[] }>();

  for (const snap of snapshots) {
    for (const rel of snap.relationships) {
      const key = `${rel.from}|${rel.to}|${rel.type}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = { first: rel, last: rel, snaps: [] };
        byKey.set(key, entry);
      }
      entry.last = rel;
      entry.snaps.push({
        from: rel.from,
        to: rel.to,
        type: rel.type,
        strength: rel.strength,
        tick: snap.tick,
      });
    }
  }

  const result: RelationshipEvolution[] = [];
  for (const entry of byKey.values()) {
    result.push({
      from: entry.first.from,
      to: entry.first.to,
      type: entry.first.type,
      initialStrength: entry.first.strength,
      finalStrength: entry.last.strength,
      delta: Math.round((entry.last.strength - entry.first.strength) * 10000) / 10000,
      snapshots: entry.snaps,
    });
  }
  result.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return result;
}

function buildAgentNodes(
  agentReports: AgentReport[],
  collectors: Map<string, AgentCollector>,
): AgentNode[] {
  return agentReports
    .filter((a) => a.role !== "control")
    .map((a) => {
      const c = collectors.get(a.agentId);
      const node: AgentNode = {
        agentId: a.agentId,
        name: a.name,
        role: a.role,
        personality: [...a.personality],
      };
      if (c?.profession) node.profession = c.profession;
      return node;
    });
}

/**
 * Computes aggregate perception/topic metrics. In perception mode this emits
 * even when no topic was opened, so entity-only/ambient simulations still
 * expose stimulus diagnostics.
 */
function computePerceptionMetrics(
  engine: WorldEngine,
  cumulative?: {
    cumulativeTotalStimuli: number;
    cumulativeStimuliByKind: Record<string, number>;
    cumulativeStimuliByChannel: Record<string, number>;
  },
): import("../../types/ReportTypes.js").PerceptionMetrics | undefined {
  const tracker = engine.getTopicTracker();
  const perceptionMode = engine.getConfig().interaction?.mode === "perception";
  const stimulusBus = engine.getStimulusBus();
  const stimuliByKind: Record<string, number> = {};
  const stimuliByChannel: Record<string, number> = {};
  let totalStimuli = 0;
  const retainedTicks = stimulusBus.getRetainedTicks();

  // Walk retained ticks only. Long runs rotate older ticks out; expose that
  // limitation explicitly in the returned metrics.
  for (const t of retainedTicks) {
    const stimuli = stimulusBus.getForTick(t);
    for (const s of stimuli) {
      totalStimuli += 1;
      stimuliByKind[s.kind] = (stimuliByKind[s.kind] ?? 0) + 1;
      stimuliByChannel[s.channel] = (stimuliByChannel[s.channel] ?? 0) + 1;
    }
  }

  if (!perceptionMode && tracker.size === 0 && totalStimuli === 0) {
    return undefined;
  }

  // Topic-derived metrics: causal coherence + reply rate.
  let speechCount = 0;
  let causalSpeechCount = 0;
  let speechWithReply = 0;
  let totalParticipants = 0;
  const topicSnapshots: Array<{
    id: string;
    stimulusIds: string[];
    participants: number;
  }> = [];

  for (const t of retainedTicks) {
    const stimuli = stimulusBus.getForTick(t);
    for (const s of stimuli) {
      if (s.kind !== "speech") continue;
      speechCount += 1;
      if (s.causedByStimulusId) causalSpeechCount += 1;
    }
  }

  const detailedTopics: Array<{
    id: string;
    label?: string;
    stimuliCount: number;
    participants: string[];
  }> = [];
  for (const topic of tracker.listTopics()) {
    const tid = topic.id;
    topicSnapshots.push({
      id: tid,
      stimulusIds: [...topic.stimulusIds],
      participants: topic.participants.size,
    });
    detailedTopics.push({
      id: tid,
      ...(topic.label ? { label: topic.label } : {}),
      stimuliCount: topic.stimulusIds.length,
      participants: [...topic.participants],
    });
    totalParticipants += topic.participants.size;
    if (topic.stimulusIds.length > 1) speechWithReply += 1;
  }

  const totalTopics = topicSnapshots.length;
  const totalStimsInTopics = topicSnapshots.reduce(
    (sum, t) => sum + t.stimulusIds.length,
    0,
  );
  detailedTopics.sort((a, b) => b.stimuliCount - a.stimuliCount);

  return {
    totalStimuli,
    stimuliByKind,
    stimuliByChannel,
    retainedStimulusTicks: retainedTicks.length,
    stimulusMetricsLimitedByRetention:
      engine.getContext().tickCount + 1 > stimulusBus.retentionWindowTicks,
    ...(cumulative && cumulative.cumulativeTotalStimuli > 0
      ? {
          cumulativeTotalStimuli: cumulative.cumulativeTotalStimuli,
          cumulativeStimuliByKind: cumulative.cumulativeStimuliByKind,
          cumulativeStimuliByChannel: cumulative.cumulativeStimuliByChannel,
        }
      : {}),
    totalTopics,
    avgStimuliPerTopic:
      totalTopics > 0 ? Math.round((totalStimsInTopics / totalTopics) * 100) / 100 : 0,
    causalCoherence: speechCount > 0 ? round3(causalSpeechCount / speechCount) : 0,
    replyRate: totalTopics > 0 ? round3(speechWithReply / totalTopics) : 0,
    avgParticipantsPerTopic:
      totalTopics > 0 ? Math.round((totalParticipants / totalTopics) * 100) / 100 : 0,
    ...(detailedTopics.length > 0 ? { topics: detailedTopics } : {}),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
