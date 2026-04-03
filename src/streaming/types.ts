import type { AgentAction, AgentStatus, AgentControlEvent, AgentInternalState, AgentProfile } from "../types/AgentTypes.js";
import type { WorldEvent, WorldStatus } from "../types/WorldTypes.js";
import type { Message } from "../messaging/Message.js";

// ─── Server → Client events ─────────────────────────────────────────

export interface ServerToClientEvents {
  /** Emitted at each world tick with summary info. */
  "world:tick": (data: TickEvent) => void;

  /** Emitted when the world status changes (running, paused, stopped). */
  "world:status": (data: { status: WorldStatus }) => void;

  /** Emitted when any agent performs an action (speak, observe, interact, tool_call, finish). */
  "agent:action": (data: AgentActionEvent) => void;

  /** Emitted when an agent's lifecycle status changes. */
  "agent:status": (data: AgentStatusEvent) => void;

  /** Emitted when a message is sent on the message bus. */
  "agent:message": (data: MessageEvent) => void;

  /** Emitted when an agent's internal state changes. */
  "agent:state": (data: AgentStateEvent) => void;

  /** Full snapshot sent on connect or on request. */
  "world:snapshot": (data: WorldSnapshot) => void;

  /** Generic world event from the event log. */
  "world:event": (data: WorldEvent) => void;

  /** Error events. */
  "error": (data: { message: string }) => void;
}

// ─── Client → Server events ─────────────────────────────────────────

export interface ClientToServerEvents {
  /** Subscribe to a specific agent's events. Joins the agent's room. */
  "subscribe:agent": (agentId: string) => void;

  /** Unsubscribe from a specific agent's events. Leaves the agent's room. */
  "unsubscribe:agent": (agentId: string) => void;

  /** Request current world snapshot. */
  "request:snapshot": () => void;

  /** Pause an agent. */
  "command:pause": (data: { agentId: string; reason?: string }) => void;

  /** Resume an agent. */
  "command:resume": (data: { agentId: string }) => void;

  /** Stop an agent. */
  "command:stop": (data: { agentId: string; reason?: string }) => void;

  /** Pause the world. */
  "command:world:pause": () => void;

  /** Resume the world. */
  "command:world:resume": () => void;

  /** Stop the world. */
  "command:world:stop": () => void;
}

// ─── Event payloads ──────────────────────────────────────────────────

export interface TickEvent {
  tick: number;
  activeAgents: number;
  totalAgents: number;
  timestamp: string;
}

export interface AgentActionEvent {
  agentId: string;
  agentName: string;
  action: AgentAction;
  tick: number;
  timestamp: string;
}

export interface AgentStatusEvent {
  agentId: string;
  agentName: string;
  oldStatus: AgentStatus;
  newStatus: AgentStatus;
  event: AgentControlEvent;
  timestamp: string;
}

export interface MessageEvent {
  message: Message;
  timestamp: string;
}

export interface AgentStateEvent {
  agentId: string;
  agentName: string;
  state: AgentInternalState;
  tick: number;
  timestamp: string;
}

export interface AgentSnapshot {
  id: string;
  name: string;
  role: "person" | "control";
  status: AgentStatus;
  profile?: AgentProfile | undefined;
  state: AgentInternalState;
}

export interface WorldSnapshot {
  worldId: string;
  status: WorldStatus;
  tick: number;
  agents: AgentSnapshot[];
  recentEvents: WorldEvent[];
  timestamp: string;
}
