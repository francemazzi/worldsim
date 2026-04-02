import type { AgentTool } from "./PluginTypes.js";
import type { ActivitySchedule, TokenBudget } from "./ScheduleTypes.js";
import type { LocationConfig } from "./LocationTypes.js";
import type { LLMConfig } from "./WorldTypes.js";

export type AgentRole = "control" | "person";

export type AgentStatus = "idle" | "running" | "paused" | "stopped";

export interface AgentControlEvent {
  type: "agent:start" | "agent:pause" | "agent:resume" | "agent:stop";
  agentId: string;
  requestedBy: string;
  tick: number;
  reason?: string | undefined;
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
  /**
   * LLM tier for this agent.
   * - "full": uses the main world LLM config (default)
   * - "light": uses WorldConfig.lightLlm for cheaper/faster inference
   * Agents with explicit `llm` config override this setting.
   */
  llmTier?: "full" | "light" | undefined;
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
  actionType: "speak" | "observe" | "interact" | "tool_call" | "finish";
  payload: unknown;
  tick: number;
}
