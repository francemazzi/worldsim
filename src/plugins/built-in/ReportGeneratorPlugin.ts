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
  SimulationMetrics,
} from "../../types/ReportTypes.js";

export interface ReportGeneratorOptions {
  engine: WorldEngine;
  /** Maximum timeline entries to keep. Default 500. */
  maxTimelineEntries?: number | undefined;
}

interface AgentCollector {
  agentId: string;
  name: string;
  role: string;
  personality: string[];
  actions: ActionDistribution;
  totalActions: number;
  moodTrajectory: AgentTickSnapshot[];
  energyTrajectory: AgentTickSnapshot[];
  statusChanges: { tick: number; from: string; to: string; reason?: string }[];
}

/**
 * Creates a ReportGeneratorPlugin that collects simulation data and produces
 * a SimulationReport when the world stops.
 *
 * Usage:
 * ```ts
 * const report = reportGeneratorPlugin({ engine });
 * engine.use(report.plugin);
 * await engine.start();
 * const data = report.getReport(); // available after world stops
 * ```
 */
export function reportGeneratorPlugin(options: ReportGeneratorOptions) {
  const maxTimeline = options.maxTimelineEntries ?? 500;

  let report: SimulationReport | null = null;
  let startTime = 0;
  const timeline: TimelineEntry[] = [];
  const allActions: AgentAction[] = [];
  const collectors = new Map<string, AgentCollector>();
  let totalEvents = 0;
  let ruleViolations = 0;

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
        actions: { speak: 0, observe: 0, interact: 0, tool_call: 0, finish: 0 },
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

  function buildReport(ctx: WorldContext, events: WorldEvent[]): SimulationReport {
    const stopTime = Date.now();
    totalEvents = events.length;

    // Build agent reports
    const agentReports: AgentReport[] = [];
    for (const c of collectors.values()) {
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
      });
    }

    // Build relationship evolution (from graph store events if available)
    const relationships: RelationshipEvolution[] = [];

    // Build metrics
    const totalSpeaks = agentReports.reduce((s, a) => s + a.actions.speak, 0);
    const totalObservations = agentReports.reduce((s, a) => s + a.actions.observe, 0);
    const totalToolCalls = agentReports.reduce((s, a) => s + a.actions.tool_call, 0);
    const totalInteractions = agentReports.reduce((s, a) => s + a.actions.interact, 0);
    const statusChanges = agentReports.reduce((s, a) => s + a.statusChanges.length, 0);

    // Average mood/energy by tick
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
      // Most common mood
      const moodCounts = new Map<string, number>();
      for (const m of data.moods) moodCounts.set(m, (moodCounts.get(m) ?? 0) + 1);
      let topMood = "neutral";
      let topCount = 0;
      for (const [mood, count] of moodCounts) {
        if (count > topCount) { topMood = mood; topCount = count; }
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
      averageMoodByTick,
      averageEnergyByTick,
    };

    return {
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
      timeline: [...timeline],
      agents: agentReports,
      relationships,
      metrics,
      rawActions: [...allActions],
    };
  }

  const plugin: WorldSimPlugin = {
    name: "report-generator",
    version: "1.0.0",
    parallel: true,

    async onBootstrap(_ctx: WorldContext, _rules: RulesContext): Promise<void> {
      startTime = Date.now();
      report = null;
      timeline.length = 0;
      allActions.length = 0;
      collectors.clear();
      totalEvents = 0;
      ruleViolations = 0;

      // Initialize collectors for all agents
      const statuses = options.engine.getAgentStatuses();
      for (const id of Object.keys(statuses)) {
        ensureCollector(id);
      }
    },

    async onWorldTick(tick: number, _ctx: WorldContext): Promise<void> {
      snapshotAgents(tick);
    },

    async onAgentAction(action: AgentAction): Promise<AgentAction> {
      allActions.push(action);
      const c = ensureCollector(action.agentId);
      c.totalActions++;
      const aType = action.actionType as keyof ActionDistribution;
      if (aType in c.actions) {
        c.actions[aType]++;
      }

      // Track speak actions in timeline
      if (action.actionType === "speak") {
        const payload = action.payload as { content?: string } | undefined;
        addTimeline({
          tick: action.tick,
          type: "action",
          agentId: action.agentId,
          description: `${c.name}: ${typeof payload?.content === "string" ? payload.content.slice(0, 120) : "spoke"}`,
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
      report = buildReport(ctx, events);
    },
  };

  return {
    plugin,
    /** Returns the report after the world stops, or null if still running. */
    getReport(): SimulationReport | null {
      return report;
    },
  };
}
