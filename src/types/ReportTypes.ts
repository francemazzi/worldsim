import type { AgentAction } from "./AgentTypes.js";

/** Summary of the entire simulation run. */
export interface SimulationSummary {
  worldId: string;
  totalTicks: number;
  agentCount: number;
  totalEvents: number;
  totalActions: number;
  durationMs: number;
  startedAt: string;
  stoppedAt: string;
}

/** A single entry in the key-events timeline. */
export interface TimelineEntry {
  tick: number;
  type: "action" | "status_change" | "rule_violation" | "policy_trigger";
  agentId?: string | undefined;
  description: string;
  data?: unknown | undefined;
}

/** Per-tick snapshot of an agent's internal state. */
export interface AgentTickSnapshot {
  tick: number;
  mood: string;
  energy: number;
}

/** Action type distribution for a single agent. */
export interface ActionDistribution {
  speak: number;
  observe: number;
  interact: number;
  tool_call: number;
  finish: number;
}

/** Per-agent report section. */
export interface AgentReport {
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

/** Relationship state at a given tick. */
export interface RelationshipSnapshot {
  from: string;
  to: string;
  type: string;
  strength: number;
  tick: number;
}

/** Tracks how a relationship evolved during the simulation. */
export interface RelationshipEvolution {
  from: string;
  to: string;
  type: string;
  initialStrength: number;
  finalStrength: number;
  delta: number;
  snapshots: RelationshipSnapshot[];
}

/** Aggregate simulation metrics. */
export interface SimulationMetrics {
  totalInteractions: number;
  totalSpeaks: number;
  totalObservations: number;
  totalToolCalls: number;
  ruleViolations: number;
  statusChanges: number;
  averageMoodByTick: { tick: number; avgMood: string }[];
  averageEnergyByTick: { tick: number; avgEnergy: number }[];
}

/** The complete simulation report. */
export interface SimulationReport {
  summary: SimulationSummary;
  timeline: TimelineEntry[];
  agents: AgentReport[];
  relationships: RelationshipEvolution[];
  metrics: SimulationMetrics;
  /** Raw actions for further analysis. */
  rawActions: AgentAction[];
}
