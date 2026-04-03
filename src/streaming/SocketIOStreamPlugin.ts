import type { Server as SocketIOServer } from "socket.io";
import type { WorldSimPlugin } from "../types/PluginTypes.js";
import type { AgentAction, AgentState, AgentStatus, AgentControlEvent } from "../types/AgentTypes.js";
import type { WorldContext, WorldEvent } from "../types/WorldTypes.js";
import type { RulesContext } from "../types/RulesTypes.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  AgentActionEvent,
  AgentStatusEvent,
  TickEvent,
} from "./types.js";

type TypedSocketIOServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;

/**
 * WorldSim plugin that streams all agent activity to connected Socket.IO clients in real-time.
 *
 * Events are broadcast to:
 * - The global room (all connected clients)
 * - Per-agent rooms (clients that subscribed to a specific agent via `subscribe:agent`)
 */
export class SocketIOStreamPlugin implements WorldSimPlugin {
  readonly name = "socket-io-stream";
  readonly version = "1.0.0";
  readonly parallel = true;

  private io: TypedSocketIOServer;
  private agentNames: Map<string, string> = new Map();
  private activeAgentCount = 0;
  private totalAgentCount = 0;

  constructor(io: TypedSocketIOServer) {
    this.io = io;
  }

  async onBootstrap(ctx: WorldContext, _rules: RulesContext): Promise<void> {
    // Agent names will be populated by WorldSimServer after bootstrap
    this.io.emit("world:status", { status: "running" });
  }

  /**
   * Called by WorldSimServer to register agent names for display.
   */
  registerAgentName(agentId: string, name: string): void {
    this.agentNames.set(agentId, name);
  }

  /**
   * Called by WorldSimServer to set agent counts for tick events.
   */
  setAgentCounts(active: number, total: number): void {
    this.activeAgentCount = active;
    this.totalAgentCount = total;
  }

  async onWorldTick(tick: number, _ctx: WorldContext): Promise<void> {
    const event: TickEvent = {
      tick,
      activeAgents: this.activeAgentCount,
      totalAgents: this.totalAgentCount,
      timestamp: new Date().toISOString(),
    };
    this.io.emit("world:tick", event);
  }

  async onAgentAction(action: AgentAction, _state: AgentState): Promise<AgentAction> {
    const event: AgentActionEvent = {
      agentId: action.agentId,
      agentName: this.agentNames.get(action.agentId) ?? action.agentId,
      action,
      tick: action.tick,
      timestamp: new Date().toISOString(),
    };

    // Broadcast globally
    this.io.emit("agent:action", event);

    // Broadcast to agent-specific room
    this.io.to(`agent:${action.agentId}`).emit("agent:action", event);

    return action;
  }

  async onAgentStatusChange(
    event: AgentControlEvent,
    oldStatus: AgentStatus,
    newStatus: AgentStatus,
  ): Promise<void> {
    const statusEvent: AgentStatusEvent = {
      agentId: event.agentId,
      agentName: this.agentNames.get(event.agentId) ?? event.agentId,
      oldStatus,
      newStatus,
      event,
      timestamp: new Date().toISOString(),
    };

    this.io.emit("agent:status", statusEvent);
    this.io.to(`agent:${event.agentId}`).emit("agent:status", statusEvent);
  }

  async onWorldStop(_ctx: WorldContext, events: WorldEvent[]): Promise<void> {
    this.io.emit("world:status", { status: "stopped" });

    // Send last batch of events
    for (const event of events.slice(-50)) {
      this.io.emit("world:event", event);
    }
  }
}
