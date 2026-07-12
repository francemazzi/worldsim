import type { AgentTool } from "./PluginTypes.js";
import type { ActivitySchedule, TokenBudget } from "./ScheduleTypes.js";
import type { LocationConfig } from "./LocationTypes.js";
import type { LLMConfig } from "./WorldTypes.js";
import type { ThinkingDelayConfig, TimelineMetadata } from "./TimelineTypes.js";
import type { SenseConfig, AttentionConfig } from "./PerceptionTypes.js";
import type { NeedsState } from "./NeedsTypes.js";

export type AgentRole = "control" | "person";

export type AgentStatus = "idle" | "running" | "paused" | "stopped";

export interface AgentControlEvent {
  type: "agent:start" | "agent:pause" | "agent:resume" | "agent:stop";
  agentId: string;
  requestedBy: string;
  tick: number;
  reason?: string | undefined;
  metadata?: TimelineMetadata | undefined;
}

export interface AgentProfile {
  name: string;
  age?: number | undefined;
  profession?: string | undefined;
  personality: string[];
  goals: string[];
  backstory?: string | undefined;
  skills?: string[] | undefined;
  customFields?: Record<string, unknown> | undefined;
  location?: LocationConfig | undefined;
}

export interface AgentInternalState {
  mood: string;
  energy: number;
  goals: string[];
  beliefs: Record<string, unknown>;
  knowledge: Record<string, unknown>;
  custom: Record<string, unknown>;
}

export interface McpServerConfig {
  /** Unique name for this MCP server (used as tool name prefix: mcp_{name}_{tool}) */
  name: string;
  /** Transport type */
  transport: "stdio" | "http";
  /** For stdio: the command to spawn */
  command?: string | undefined;
  /** For stdio: command arguments */
  args?: string[] | undefined;
  /** For stdio: environment variables */
  env?: Record<string, string> | undefined;
  /** For stdio: working directory */
  cwd?: string | undefined;
  /** For http: the server URL */
  url?: string | undefined;
  /** For http: custom headers (e.g. auth tokens) */
  headers?: Record<string, string> | undefined;
  /** Only expose these tool names from this server. If omitted, all tools are exposed. */
  toolFilter?: string[] | undefined;
  /** Timeout in ms for individual tool calls. Default: 30000 */
  toolCallTimeoutMs?: number | undefined;
}

export interface AgentConfig {
  id: string;
  role: AgentRole;
  name: string;
  description?: string | undefined;
  iterationsPerTick?: number | undefined;
  systemPrompt?: string | undefined;
  profile?: AgentProfile | undefined;
  tools?: AgentTool[] | undefined;
  initialState?: Partial<AgentInternalState> | undefined;
  toolNames?: string[] | undefined;
  schedule?: ActivitySchedule | undefined;
  tokenBudget?: TokenBudget | undefined;
  llm?: Partial<LLMConfig> | undefined;
  neighborhood?: {
    maxContacts?: number | undefined;
    groups?: string[] | undefined;
  } | undefined;
  /** If true, agent always makes LLM call even when idle. Default false. */
  alwaysThink?: boolean | undefined;
  /** Simulated time spent thinking before each observable action. */
  thinkingDelayMs?: ThinkingDelayConfig | undefined;
  /**
   * LLM tier for this agent.
   * - "full": uses the main world LLM config (default)
   * - "light": uses WorldConfig.lightLlm for cheaper/faster inference
   * Agents with explicit `llm` config override this setting.
   */
  llmTier?: "full" | "light" | undefined;
  /** External MCP servers this agent can connect to */
  mcp?: McpServerConfig[] | undefined;
  /**
   * Per-channel sensory configuration. Used by the PerceptionEngine when
   * `WorldConfig.interaction.mode === "perception"`. When omitted the world
   * applies `interaction.defaultSenses`. Pass an empty array to declare an
   * agent that perceives nothing (rare — useful for purely outbound bots).
   */
  senses?: SenseConfig[] | undefined;
  /**
   * Attention/salience tuning. Only consulted in `perception` mode.
   */
  attention?: AttentionConfig | undefined;
  /**
   * Initial drives/needs (hunger, fatigue, fear, …). The NeedsTracker
   * (Phase 4) decays/regenerates these per tick when configured.
   */
  needs?: NeedsState | undefined;
}

export interface AgentState {
  agentId: string;
  status: AgentStatus;
  currentMessages: AgentMessage[];
  loopCount: number;
  lastActionAt?: Date | undefined;
  ephemeralMemory: Record<string, unknown>;
}

export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string | undefined;
  name?: string | undefined;
  toolCalls?: {
    id: string;
    name: string;
    arguments: string;
  }[] | undefined;
}

export interface AgentAction {
  agentId: string;
  actionType:
    | "speak"
    | "observe"
    | "interact"
    | "tool_call"
    | "finish"
    /**
     * Passive acknowledgement that an agent perceived something during a
     * tick without producing a louder reaction. Emitted by the perception
     * layer (Phase 1+) when an agent's only output is "I noticed X".
     */
    | "perceive";
  payload: unknown;
  tick: number;
  /**
   * Timeline fields plus opaque integrator correlation metadata under
   * `custom`. Nested keys are forwarded to routed messages and delivery
   * observers unchanged.
   */
  metadata?: TimelineMetadata | undefined;
}
