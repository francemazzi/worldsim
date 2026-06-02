import type { AgentAction } from "./AgentTypes.js";
import type { TimelineMetadata } from "./TimelineTypes.js";

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
  metadata?: TimelineMetadata | undefined;
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
  /** Passive acknowledgements emitted by the perception layer. */
  perceive: number;
}

export interface AgentObservabilityMetrics {
  tokenUsage: {
    tickTokens: number;
    hourTokens: number;
    lifetimeTokens: number;
    tickRequests: number;
    hourRequests: number;
    lifetimeRequests: number;
  };
  latency: {
    avgMs: number;
    lastMs: number;
    maxMs: number;
  };
  cost: {
    estimated: number;
    currency: string;
  };
  storage?: {
    memoryEntries: number;
    stateSnapshots: number;
    conversations: number;
    consolidatedKnowledge: number;
    estimatedBytes: number;
  } | undefined;
  graph?: {
    relationships: number;
    averageStrength: number;
  } | undefined;
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
  observability?: AgentObservabilityMetrics | undefined;
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
  totalTokens: number;
  avgLatencyMs: number;
  estimatedCost: { amount: number; currency: string };
  averageMoodByTick: { tick: number; avgMood: string }[];
  averageEnergyByTick: { tick: number; avgEnergy: number }[];
  /**
   * Realistic Simulation metrics. Present only when the perception layer
   * was active (`WorldConfig.interaction.mode === "perception"`).
   */
  perception?: PerceptionMetrics | undefined;
}

/** A single topic snapshot included in the perception metrics. */
export interface PerceptionTopicSummary {
  id: string;
  label?: string | undefined;
  stimuliCount: number;
  participants: string[];
}

/** Aggregate metrics for the perception/attention/topic layer. */
export interface PerceptionMetrics {
  /**
   * Stimuli visible to the report generator. When
   * `stimulusMetricsLimitedByRetention` is true this is the retained-window
   * count, not a full-run total.
   */
  totalStimuli: number;
  /** Stimuli classified by kind. */
  stimuliByKind: Record<string, number>;
  /** Stimuli classified by channel. */
  stimuliByChannel: Record<string, number>;
  /** Number of stimulus ticks retained by the StimulusBus. */
  retainedStimulusTicks: number;
  /** True when stimulus counts may omit older ticks evicted by retention. */
  stimulusMetricsLimitedByRetention: boolean;
  /** Number of distinct topics opened over the run. */
  totalTopics: number;
  /** Average number of stimuli per topic. */
  avgStimuliPerTopic: number;
  /**
   * Fraction of speech stimuli that were causally linked to a parent
   * (in-thread responses). 1.0 = perfect causal coherence.
   */
  causalCoherence: number;
  /**
   * Fraction of speech stimuli that received at least one in-thread reply
   * within the topic window. 1.0 = nobody is talking to a wall.
   */
  replyRate: number;
  /** Average number of participants per topic. */
  avgParticipantsPerTopic: number;
  /**
   * Optional list of topics opened during the run, ordered by activity.
   * Populated by the report generator when the topic tracker is reachable.
   */
  topics?: PerceptionTopicSummary[] | undefined;
}

/* ------------------------------------------------------------------ */
/*  Sociological analysis types                                        */
/* ------------------------------------------------------------------ */

/** Lightweight descriptor for a node in the sociogram. */
export interface AgentNode {
  agentId: string;
  name: string;
  role: string;
  personality: string[];
  profession?: string | undefined;
}

/** Per-agent centrality measures derived from the final relationship graph. */
export interface CentralityScore {
  agentId: string;
  degree: number;
  betweenness: number;
  eigenvector: number;
}

/** Density of the social graph at a given tick. */
export interface DensityPoint {
  tick: number;
  value: number;
}

/** A connected cluster / coalition in the social graph. */
export interface Community {
  id: string;
  members: string[];
  cohesion: number;
}

/** Newman-style assortativity for a categorical attribute. */
export interface HomophilyScore {
  attribute: string;
  assortativity: number;
}

/** A qualitative change in the relationship graph over time. */
export interface RelationshipChange {
  type: "created" | "broken" | "type_changed" | "strengthened" | "weakened";
  from: string;
  to: string;
  tick: number;
  fromType?: string | undefined;
  toType?: string | undefined;
  delta?: number | undefined;
}

/** Aggregated network-level analysis of the run. */
export interface NetworkAnalysis {
  sociogramFinal: {
    nodes: AgentNode[];
    edges: RelationshipSnapshot[];
  };
  centrality: CentralityScore[];
  density: DensityPoint[];
  communities: Community[];
  reciprocity: number;
  homophily: HomophilyScore[];
  relationshipChanges: RelationshipChange[];
}

/** Directed (or broadcast) who-talks-to-whom count. */
export interface SpeakEdge {
  from: string;
  /** Agent id of the addressee or "*" for broadcast. */
  to: string;
  count: number;
}

/** Per-agent volume of spoken communication. */
export interface VoiceShare {
  agentId: string;
  speaks: number;
  wordsApprox: number;
}

/** Per-agent average message length and variance. */
export interface MessageLengthStat {
  agentId: string;
  avg: number;
  stddev: number;
}

/** Aggregate statistics of the ConversationManager, when available. */
export interface ConversationStats {
  total: number;
  avgTurns: number;
  initiatedBy: Record<string, number>;
}

/** How often each agent's direct speaks receive a reply. */
export interface ResponseRate {
  agentId: string;
  speaksOut: number;
  repliesReceived: number;
  rate: number;
}

/** Aggregated dialogical analysis of the run. */
export interface DialogueAnalysis {
  speakMatrix: SpeakEdge[];
  voiceGini: number;
  voiceByAgent: VoiceShare[];
  avgMessageChars: MessageLengthStat[];
  conversationStats: ConversationStats;
  responseRate: ResponseRate[];
}

/** Aggregates measured on a time window. */
export interface ShockWindowStats {
  avgMood: string;
  avgEnergy: number;
  speakRate: number;
  violationRate: number;
  toolCallRate: number;
}

/** Deltas between post- and pre-trigger windows. */
export interface ShockDeltas {
  avgEnergy: number;
  speakRate: number;
  violationRate: number;
  toolCallRate: number;
  moodChanged: boolean;
}

/** Measures the impact of a policy trigger on the community. */
export interface PolicyShockAnalysis {
  triggerTick: number;
  windowTicks: number;
  description?: string | undefined;
  pre: ShockWindowStats;
  post: ShockWindowStats;
  deltas: ShockDeltas;
  recoveryTicks: number | null;
}

/** Reaction archetype for an agent after the policy shock. */
export type ReactionArchetype =
  | "compliant"
  | "skeptic"
  | "resistant"
  | "apathetic";

/** Agent archetype with rationale derived from heuristics. */
export interface AgentArchetype {
  agentId: string;
  archetype: ReactionArchetype;
  score: number;
  rationale: string;
  subScores: Record<ReactionArchetype, number>;
}

/** Per-tick correlation of mood shift with neighborhood valence. */
export interface ContagionPoint {
  tick: number;
  correlationNeighbors: number;
}

/** Variance of mood valence across agents at a tick. */
export interface MoodVariancePoint {
  tick: number;
  variance: number;
}

/** Aggregated archetype analysis of the run. */
export interface ArchetypeAnalysis {
  perAgent: AgentArchetype[];
  emotionalContagion: ContagionPoint[];
  moodVarianceByTick: MoodVariancePoint[];
}

/** A single arc phase description produced by the LLM narrator. */
export interface NarrativeArc {
  phase: "pre" | "trigger" | "post" | "full";
  summary: string;
}

/** Per-agent narrative summary. */
export interface AgentArc {
  agentId: string;
  arc: string;
}

/** An emblematic quote extracted from the timeline. */
export interface NarrativeQuote {
  agentId: string;
  tick: number;
  content: string;
  tag: string;
}

/** Dominant topic descriptor derived from the perception layer. */
export interface NarrativeTopicSummary {
  id: string;
  label?: string | undefined;
  stimuliCount: number;
  participants: string[];
}

/** A single moment when an agent's need crossed its critical threshold. */
export interface CriticalNeedMoment {
  agentId: string;
  needId: string;
  tick: number;
}

/**
 * Qualitative-but-deterministic insights derived from the perception
 * layer. Always computable without an LLM call; produced even when no
 * API key is configured so the dashboard can render them.
 */
export interface PerceptionInsights {
  /** Topics with the largest stimulus volume, sorted descending. */
  dominantTopics: NarrativeTopicSummary[];
  /**
   * Ratio of passive `perceive` actions over the sum of `perceive +
   * speak`. Higher values indicate "quiet, attentive" runs; values close
   * to zero indicate dense chatter.
   */
  silenceRatio: number;
  /** Ticks/agents where a need crossed its critical threshold. */
  criticalNeedMoments: CriticalNeedMoment[];
}

/** Qualitative narrative section produced by an LLM (opt-in). */
export interface NarrativeReport {
  arc: NarrativeArc[];
  perAgentArc: AgentArc[];
  quotes: NarrativeQuote[];
  /**
   * Perception-aware insights. Populated whenever the source
   * `SimulationReport` carries perception metrics, even without an LLM.
   */
  perceptionInsights?: PerceptionInsights | undefined;
  generatedAt: string;
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
  /** Network / graph analysis (optional, populated when relationships exist). */
  network?: NetworkAnalysis | undefined;
  /** Dialogical analysis (optional, populated when speak actions exist). */
  dialogue?: DialogueAnalysis | undefined;
  /** Policy shock analysis (optional, only when a policy_trigger entry exists). */
  shock?: PolicyShockAnalysis | null | undefined;
  /** Reaction archetypes (optional, heuristic-based). */
  archetypes?: ArchetypeAnalysis | undefined;
  /** Qualitative narrative produced by an LLM (optional, opt-in). */
  narrative?: NarrativeReport | null | undefined;
}

export interface TopicInsight {
  topic: string;
  evidence: string;
  trend: "rising" | "stable" | "falling";
  confidence: number;
}

export interface LiveReportResponse {
  ready: boolean;
  worldId: string;
  runId: string;
  status: "idle" | "running" | "stopped";
  tick: number;
  updatedAt: string;
  report: SimulationReport | null;
}

export interface StoredRunSummary {
  runId: string;
  worldId: string;
  status: "running" | "stopped";
  startedAt: string;
  stoppedAt?: string | undefined;
  tick: number;
  totalActions: number;
  totalAgents: number;
}

export interface ReportCompareResponse {
  runIds: string[];
  worlds: string[];
  metrics: {
    totalActionsDelta: number;
    totalToolCallsDelta: number;
    totalSpeaksDelta: number;
    averageEnergyDelta: number;
    ruleViolationsDelta: number;
    totalTokensDelta: number;
    avgLatencyDelta: number;
    estimatedCostDelta: number;
  };
}
