import { exec } from "node:child_process";
import { platform } from "node:os";
import { StudioServer } from "./StudioServer.js";
import { STUDIO_DEFAULTS, type StudioOptions } from "./StudioConfig.js";
import type { WorldSimPlugin } from "../types/PluginTypes.js";
import type { AgentAction, AgentState, AgentControlEvent, AgentStatus } from "../types/AgentTypes.js";
import type { WorldContext, WorldEvent } from "../types/WorldTypes.js";

/**
 * Creates a WorldSim Studio plugin that serves a dashboard UI.
 *
 * Usage:
 * ```ts
 * const engine = new WorldEngine(config);
 * engine.use(studioPlugin({
 *   engine,
 *   port: 4400,
 *   memoryStore: config.memoryStore,
 *   graphStore: config.graphStore,
 * }));
 * await engine.start();
 * ```
 */
export function studioPlugin(options: StudioOptions): WorldSimPlugin {
  const port = options.port ?? STUDIO_DEFAULTS.port;
  const shouldOpen = options.open ?? STUDIO_DEFAULTS.open;

  const stores: import("./StoreDetector.js").StoreRefs = {};
  if (options.memoryStore) stores.memoryStore = options.memoryStore;
  if (options.graphStore) stores.graphStore = options.graphStore;
  if (options.vectorStore) stores.vectorStore = options.vectorStore;
  if (options.embeddingAdapter) stores.embeddingAdapter = options.embeddingAdapter;
  if (options.persistenceStore) stores.persistenceStore = options.persistenceStore;

  const serverOpts: {
    engine?: import("../engine/WorldEngine.js").WorldEngine;
    stores?: import("./StoreDetector.js").StoreRefs;
    port?: number;
    corsOrigin?: string | string[];
    reportGetter?: (() => import("../types/ReportTypes.js").SimulationReport | null) | undefined;
  } = { engine: options.engine, stores, port };
  if (options.corsOrigin) serverOpts.corsOrigin = options.corsOrigin;
  if (options.reportGetter) serverOpts.reportGetter = options.reportGetter;

  const server = new StudioServer(serverOpts);

  // Agent name lookup for WS events
  const agentNames = new Map<string, string>();

  const plugin: WorldSimPlugin = {
    name: "worldsim-studio",
    version: "1.0.0",
    parallel: true,

    async onBootstrap(ctx: WorldContext): Promise<void> {
      await server.start();
      const url = `http://localhost:${port}`;
      console.log(`[WorldSim Studio] Dashboard ready at ${url}`);

      if (shouldOpen) {
        openBrowser(url);
      }

      // Pre-populate agent names
      const engine = options.engine;
      const statuses = engine.getAgentStatuses();
      for (const id of Object.keys(statuses)) {
        const agent = engine.getAgent(id);
        if (agent) {
          agentNames.set(id, agent.getProfile()?.name ?? id);
        }
      }
    },

    async onWorldTick(tick: number, _ctx: WorldContext): Promise<void> {
      const statuses = options.engine.getAgentStatuses();
      const active = Object.values(statuses).filter((s) => s === "running" || s === "idle").length;

      server.getIO().emit("world:tick", {
        tick,
        activeAgents: active,
        totalAgents: Object.keys(statuses).length,
        timestamp: new Date().toISOString(),
      });
    },

    async onAgentAction(action: AgentAction, _state: AgentState): Promise<AgentAction> {
      const event = {
        agentId: action.agentId,
        agentName: agentNames.get(action.agentId) ?? action.agentId,
        action,
        tick: action.tick,
        timestamp: new Date().toISOString(),
      };

      server.getIO().emit("agent:action", event);
      server.getIO().to(`agent:${action.agentId}`).emit("agent:action", event);

      return action;
    },

    async onAgentStatusChange(
      event: AgentControlEvent,
      oldStatus: AgentStatus,
      newStatus: AgentStatus,
    ): Promise<void> {
      const statusEvent = {
        agentId: event.agentId,
        agentName: agentNames.get(event.agentId) ?? event.agentId,
        oldStatus,
        newStatus,
        event,
        timestamp: new Date().toISOString(),
      };

      server.getIO().emit("agent:status", statusEvent);
      server.getIO().to(`agent:${event.agentId}`).emit("agent:status", statusEvent);
    },

    async onWorldStop(_ctx: WorldContext, _events: WorldEvent[]): Promise<void> {
      server.getIO().emit("world:status", { status: "stopped" });
      console.log(`[WorldSim Studio] World stopped. Dashboard still available at http://localhost:${port}`);
    },
  };

  return plugin;
}

function openBrowser(url: string): void {
  const cmd =
    platform() === "darwin"
      ? `open "${url}"`
      : platform() === "win32"
        ? `start "${url}"`
        : `xdg-open "${url}"`;

  exec(cmd, () => {
    // Ignore errors — browser open is best-effort
  });
}
