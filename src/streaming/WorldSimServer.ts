import { createServer, type Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { WorldEngine } from "../engine/WorldEngine.js";
import { SocketIOStreamPlugin } from "./SocketIOStreamPlugin.js";
import type { WorldConfig } from "../types/WorldTypes.js";
import type { AgentConfig } from "../types/AgentTypes.js";
import type { WorldSimPlugin } from "../types/PluginTypes.js";
import { ChatPlugin } from "../plugins/built-in/ChatPlugin.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  WorldSnapshot,
  AgentSnapshot,
} from "./types.js";

type TypedSocketIOServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;

export interface WorldSimServerOptions {
  /** Port to listen on. Default: 3000. */
  port?: number;
  /** CORS origin for Socket.IO. Default: "*". */
  corsOrigin?: string | string[];
  /** Existing HTTP server to attach to (skips creating a new one). */
  httpServer?: HttpServer;
  /** Additional Socket.IO server options. */
  socketIOOptions?: Partial<Record<string, unknown>>;
}

/**
 * Wraps a WorldEngine with an HTTP server and Socket.IO for real-time streaming.
 *
 * Usage:
 * ```ts
 * const server = new WorldSimServer(worldConfig, { port: 3000 });
 * server.addAgent({ id: "alice", role: "person", name: "Alice", ... });
 * server.use(myPlugin);
 * await server.start();
 * ```
 *
 * Socket.IO events:
 * - `world:tick` — each simulation tick
 * - `world:status` — world status changes
 * - `world:snapshot` — full state snapshot (on connect or request)
 * - `agent:action` — agent actions (speak, observe, interact, tool_call, finish)
 * - `agent:status` — agent lifecycle changes (start, pause, resume, stop)
 * - `agent:message` — messages on the bus
 *
 * Client commands:
 * - `subscribe:agent` / `unsubscribe:agent` — join/leave agent-specific rooms
 * - `command:pause` / `command:resume` / `command:stop` — control agents
 * - `command:world:pause` / `command:world:resume` / `command:world:stop` — control world
 * - `request:snapshot` — request current world snapshot
 */
export class WorldSimServer {
  private engine: WorldEngine;
  private httpServer: HttpServer;
  private io: TypedSocketIOServer;
  private streamPlugin: SocketIOStreamPlugin;
  private port: number;
  private agentConfigs: AgentConfig[] = [];
  private ownsHttpServer: boolean;

  constructor(worldConfig: WorldConfig, options: WorldSimServerOptions = {}) {
    this.port = options.port ?? 3000;

    // Create or reuse HTTP server
    if (options.httpServer) {
      this.httpServer = options.httpServer;
      this.ownsHttpServer = false;
    } else {
      this.httpServer = createServer();
      this.ownsHttpServer = true;
    }

    // Create Socket.IO server
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: options.corsOrigin ?? "*",
        methods: ["GET", "POST"],
      },
      ...options.socketIOOptions,
    }) as TypedSocketIOServer;

    // Create the stream plugin
    this.streamPlugin = new SocketIOStreamPlugin(this.io);

    // Create the world engine with the stream plugin auto-registered
    this.engine = new WorldEngine(worldConfig);
    this.engine.use(this.streamPlugin);

    // Setup Socket.IO connection handling
    this.setupSocketHandlers();
  }

  /** Register a plugin on the world engine. */
  use(plugin: WorldSimPlugin): this {
    this.engine.use(plugin);
    return this;
  }

  /** Add an agent to the world. */
  addAgent(config: AgentConfig): this {
    this.agentConfigs.push(config);
    this.engine.addAgent(config);
    this.streamPlugin.registerAgentName(config.id, config.name);
    return this;
  }

  /** Register a tick handler. */
  on(event: "tick", handler: (tick: number) => void): this {
    this.engine.on(event, handler);
    return this;
  }

  /**
   * Start only the HTTP + Socket.IO server (does not start the simulation).
   * Useful when you need clients to connect before the simulation begins.
   */
  async listen(): Promise<void> {
    if (this.ownsHttpServer && !this.httpServer.listening) {
      await new Promise<void>((resolve) => {
        this.httpServer.listen(this.port, () => {
          resolve();
        });
      });
    }
  }

  /** Start the world simulation and HTTP server. */
  async start(): Promise<void> {
    await this.listen();

    // Update agent counts
    this.streamPlugin.setAgentCounts(this.agentConfigs.length, this.agentConfigs.length);

    // Notify connected clients that the world is starting
    this.io.emit("world:status", { status: "bootstrapping" });

    // Configure ChatPlugin if registered
    this.configureChatPlugin();

    // Start the engine (this blocks until maxTicks or stop)
    await this.engine.start();
  }

  /**
   * Wires the ChatPlugin with agent resolver and memory persister
   * after the engine is ready. Safe to call if ChatPlugin is not registered.
   */
  private configureChatPlugin(): void {
    const chatPlugin = this.engine.getPlugin("chat") as ChatPlugin | undefined;
    if (!chatPlugin || typeof chatPlugin.configure !== "function") return;

    const engine = this.engine;
    const deps: Parameters<ChatPlugin["configure"]>[0] = {
      agentResolver: (id: string) => engine.getAgent(id),
      memoryPersister: async (entries, worldId) => {
        const brain = engine.getBrainMemory();
        if (brain) {
          await brain.saveBatch(entries, worldId);
        }
      },
    };
    const rules = engine.getRulesContext();
    if (rules) deps.rulesContext = rules;
    chatPlugin.configure(deps);
  }

  /** Stop the world and close the server. */
  async stop(): Promise<void> {
    await this.engine.stop();
    this.io.emit("world:status", { status: "stopped" });
  }

  /** Pause the world simulation. */
  async pause(): Promise<void> {
    await this.engine.pause();
    this.io.emit("world:status", { status: "paused" });
  }

  /** Resume the world simulation. */
  async resume(): Promise<void> {
    this.io.emit("world:status", { status: "running" });
    await this.engine.resume();
  }

  /** Close the HTTP server and all Socket.IO connections. */
  async close(): Promise<void> {
    await this.stop();
    await this.io.close();
    if (this.ownsHttpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }

  /** Access the underlying WorldEngine. */
  getEngine(): WorldEngine {
    return this.engine;
  }

  /** Access the Socket.IO server instance. */
  getIO(): TypedSocketIOServer {
    return this.io;
  }

  /** Access the HTTP server instance. */
  getHttpServer(): HttpServer {
    return this.httpServer;
  }

  private buildSnapshot(): WorldSnapshot {
    const statuses = this.engine.getAgentStatuses();
    const agents: AgentSnapshot[] = this.agentConfigs.map((cfg) => {
      const agent = this.engine.getAgent(cfg.id);
      return {
        id: cfg.id,
        name: cfg.name,
        role: cfg.role,
        status: statuses[cfg.id] ?? "idle",
        profile: cfg.profile,
        state: agent?.getInternalState() ?? {
          mood: "neutral",
          energy: 100,
          goals: [],
          beliefs: {},
          knowledge: {},
          custom: {},
        },
      };
    });

    const eventLog = this.engine.getEventLog();
    const recentEvents = eventLog.slice(-100);

    return {
      worldId: this.engine.getContext().worldId,
      status: this.engine.getStatus(),
      tick: this.engine.getContext().tickCount,
      agents,
      recentEvents,
      timestamp: new Date().toISOString(),
    };
  }

  private setupSocketHandlers(): void {
    this.io.on("connection", (socket) => {
      // Send snapshot on connect
      const snapshot = this.buildSnapshot();
      socket.emit("world:snapshot", snapshot);

      // ─── Subscribe/unsubscribe to agent rooms ───
      socket.on("subscribe:agent", (agentId: string) => {
        socket.join(`agent:${agentId}`);
      });

      socket.on("unsubscribe:agent", (agentId: string) => {
        socket.leave(`agent:${agentId}`);
      });

      // ─── Request snapshot ───
      socket.on("request:snapshot", () => {
        socket.emit("world:snapshot", this.buildSnapshot());
      });

      // ─── Agent control commands ───
      socket.on("command:pause", (data) => {
        try {
          this.engine.pauseAgent(data.agentId, data.reason);
        } catch (err) {
          socket.emit("error", {
            message: `Failed to pause agent ${data.agentId}: ${(err as Error).message}`,
          });
        }
      });

      socket.on("command:resume", (data) => {
        try {
          this.engine.resumeAgent(data.agentId);
        } catch (err) {
          socket.emit("error", {
            message: `Failed to resume agent ${data.agentId}: ${(err as Error).message}`,
          });
        }
      });

      socket.on("command:stop", (data) => {
        try {
          this.engine.stopAgent(data.agentId, data.reason);
        } catch (err) {
          socket.emit("error", {
            message: `Failed to stop agent ${data.agentId}: ${(err as Error).message}`,
          });
        }
      });

      // ─── World control commands ───
      socket.on("command:world:pause", () => {
        this.pause().catch((err) => {
          socket.emit("error", {
            message: `Failed to pause world: ${(err as Error).message}`,
          });
        });
      });

      socket.on("command:world:resume", () => {
        this.resume().catch((err) => {
          socket.emit("error", {
            message: `Failed to resume world: ${(err as Error).message}`,
          });
        });
      });

      socket.on("command:world:stop", () => {
        this.stop().catch((err) => {
          socket.emit("error", {
            message: `Failed to stop world: ${(err as Error).message}`,
          });
        });
      });

      // ─── GPS position push ───
      socket.on("command:update-position", (data) => {
        try {
          this.engine.updateAgentPosition(data.agentId, data.latitude, data.longitude, data.label);
          this.io.emit("agent:moved", {
            agentId: data.agentId,
            agentName: this.streamPlugin.getAgentName(data.agentId),
            from: null,
            to: { latitude: data.latitude, longitude: data.longitude, label: data.label },
            tick: this.engine.getContext().tickCount,
            source: "external_gps",
            timestamp: new Date().toISOString(),
          });
        } catch (err) {
          socket.emit("error", {
            message: `Failed to update position for ${data.agentId}: ${(err as Error).message}`,
          });
        }
      });

      // ─── Chat with agent ───
      socket.on("chat:send", (data) => {
        const chatPlugin = this.engine.getPlugin("chat") as ChatPlugin | undefined;
        if (!chatPlugin || typeof chatPlugin.handleChat !== "function") {
          socket.emit("error", { message: "Chat plugin not registered" });
          return;
        }
        const userId = socket.id;
        chatPlugin
          .handleChat(data.agentId, userId, data.message, data.sessionId)
          .then((response) => {
            socket.emit("chat:response", response);
          })
          .catch((err: unknown) => {
            socket.emit("error", {
              message: `Chat failed: ${(err as Error).message}`,
            });
          });
      });

      socket.on("chat:history", (data) => {
        const chatPlugin = this.engine.getPlugin("chat") as ChatPlugin | undefined;
        if (!chatPlugin || typeof chatPlugin.getHistory !== "function") {
          socket.emit("error", { message: "Chat plugin not registered" });
          return;
        }
        const history = chatPlugin.getHistory(data.agentId, data.sessionId);
        socket.emit("chat:history", history);
      });
    });
  }
}
