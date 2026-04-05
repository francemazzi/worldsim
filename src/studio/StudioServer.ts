import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Server as SocketIOServer } from "socket.io";
import { StudioRouter } from "./StudioRouter.js";
import { registerStoresApi } from "./api/storesApi.js";
import { registerAgentsApi } from "./api/agentsApi.js";
import { registerEventsApi } from "./api/eventsApi.js";
import { registerMemoryApi } from "./api/memoryApi.js";
import { registerGraphApi } from "./api/graphApi.js";
import { registerPersistenceApi } from "./api/persistenceApi.js";
import { registerVectorApi } from "./api/vectorApi.js";
import { registerReportApi } from "./api/reportApi.js";
import { registerScenarioApi, type ScenarioPreset } from "./api/scenarioApi.js";
import { loadScenario, type ScenarioConfig } from "./ScenarioLoader.js";
import { detectCapabilities, type StoreRefs } from "./StoreDetector.js";
import { STUDIO_DEFAULTS } from "./StudioConfig.js";
import { MultiWorldRegistry } from "./MultiWorldRegistry.js";
import type { WorldEngine } from "../engine/WorldEngine.js";
import type { SimulationReport } from "../types/ReportTypes.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  AgentSnapshot,
  WorldSnapshot,
} from "../streaming/types.js";

type TypedSocketIOServer = SocketIOServer<ClientToServerEvents, ServerToClientEvents>;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

export class StudioServer {
  private httpServer: HttpServer;
  private io: TypedSocketIOServer;
  private router: StudioRouter;
  private engine: WorldEngine | null;
  private stores: StoreRefs;
  private port: number;
  private uiDir: string;
  private reportGetter: (() => SimulationReport | null) | null;
  private scenarioPresets: ScenarioPreset[];
  private worldRegistry: MultiWorldRegistry;

  constructor(options: {
    engine?: WorldEngine | undefined;
    stores?: StoreRefs | undefined;
    port?: number | undefined;
    corsOrigin?: string | string[] | undefined;
    reportGetter?: (() => SimulationReport | null) | undefined;
    scenarioPresets?: ScenarioPreset[] | undefined;
  }) {
    this.engine = options.engine ?? null;
    this.stores = options.stores ?? {};
    this.port = options.port ?? STUDIO_DEFAULTS.port;
    this.reportGetter = options.reportGetter ?? null;
    this.scenarioPresets = options.scenarioPresets ?? [];
    this.worldRegistry = new MultiWorldRegistry();

    if (this.engine) {
      this.worldRegistry.registerWorld(
        this.engine.getContext().worldId,
        this.engine,
        this.reportGetter ?? undefined,
      );
      this.setupEngineEvents(this.engine);
    }

    // UI directory: at build time, static assets are copied to dist/studio/ui
    // Try multiple candidate paths since __dirname varies depending on bundler output
    let currentDir: string;
    try {
      currentDir = typeof __dirname !== "undefined" ? __dirname : fileURLToPath(new URL(".", import.meta.url));
    } catch {
      currentDir = process.cwd();
    }
    const candidates = [
      join(currentDir, "ui"),                    // dev: src/studio/ → src/studio/ui
      join(currentDir, "studio", "ui"),          // bundled lib: dist/ → dist/studio/ui
      join(currentDir, "..", "studio", "ui"),     // bundled cli: dist/cli/ → dist/studio/ui
    ];
    const defaultUiDir = join(currentDir, "ui");
    this.uiDir = candidates.find((d) => {
      try { return readFileSync(join(d, "index.html")).length > 0; } catch { return false; }
    }) ?? defaultUiDir;

    this.router = new StudioRouter();
    this.httpServer = createServer((req, res) => this.handleRequest(req, res));

    const corsOrigin = options.corsOrigin ?? STUDIO_DEFAULTS.corsOrigin;
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: corsOrigin,
        methods: ["GET", "POST"],
      },
    }) as TypedSocketIOServer;

    this.registerRoutes();
    this.setupSocketHandlers();
  }

  getIO(): TypedSocketIOServer {
    return this.io;
  }

  setEngine(engine: WorldEngine): void {
    this.engine = engine;
    const worldId = engine.getContext().worldId;
    this.worldRegistry.registerWorld(worldId, engine, this.reportGetter ?? undefined);
    this.setupEngineEvents(engine);
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.httpServer.listen(this.port, () => resolve());
    });
  }

  async close(): Promise<void> {
    await this.io.close();
    await new Promise<void>((resolve, reject) => {
      this.httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  }

  getPort(): number {
    return this.port;
  }

  private registerRoutes(): void {
    const getEngine = (worldId?: string) => {
      const worldState = this.worldRegistry.getActiveWorld(worldId);
      if (worldState) return worldState.engine;
      return this.engine;
    };
    const getCapabilities = () =>
      detectCapabilities(this.stores, this.worldRegistry.listRuns().length > 0 || !!this.engine);

    registerStoresApi(this.router, getCapabilities);
    registerAgentsApi(this.router, getEngine);
    registerEventsApi(this.router, getEngine);
    registerMemoryApi(this.router, () => this.stores.memoryStore);
    registerGraphApi(this.router, () => this.stores.graphStore, getEngine);
    registerPersistenceApi(this.router, () => this.stores.persistenceStore, getEngine);
    registerVectorApi(this.router, () => this.stores.vectorStore, () => this.stores.embeddingAdapter);
    if (this.reportGetter) {
      registerReportApi(this.router, this.reportGetter, this.worldRegistry);
    } else {
      registerReportApi(this.router, () => null, this.worldRegistry);
    }

    registerScenarioApi(
      this.router,
      () => this.scenarioPresets,
      async (scenarioConfig, llmConfig) => {
        try {
          const result = loadScenario(scenarioConfig, llmConfig);
          const worldId = result.engine.getContext().worldId;
          this.engine = result.engine;
          this.stores = {
            memoryStore: result.memoryStore,
            graphStore: result.graphStore,
          };
          this.setReportGetter(result.getReport);
          this.worldRegistry.registerWorld(worldId, result.engine, result.getReport);

          // Wire events to Socket.IO
          this.setupEngineEvents(result.engine);

          // Start simulation (non-blocking)
          result.engine.start().then(() => {
            this.worldRegistry.stopWorld(worldId);
            this.io.emit("world:status", { status: "stopped" });
            this.io.to(`world:${worldId}`).emit("world:status", { status: "stopped" });
          }).catch((err) => {
            console.error("[Studio] Scenario error:", err);
          });

          return { started: true };
        } catch (err) {
          return { started: false, error: (err as Error).message };
        }
      },
    );
  }

  private setupEngineEvents(engine: WorldEngine): void {
    const worldId = engine.getContext().worldId;
    this.io.emit("world:status", { status: "running" });
    this.io.to(`world:${worldId}`).emit("world:status", { status: "running" });
    engine.on("tick", (tick) => {
      const statuses = engine.getAgentStatuses();
      const active = Object.values(statuses).filter((s) => s === "running" || s === "idle").length;
      this.worldRegistry.updateWorldTick(worldId, tick);
      this.io.emit("world:tick", {
        worldId,
        tick,
        activeAgents: active,
        totalAgents: Object.keys(statuses).length,
        timestamp: new Date().toISOString(),
      });
      this.io.to(`world:${worldId}`).emit("world:tick", {
        worldId,
        tick,
        activeAgents: active,
        totalAgents: Object.keys(statuses).length,
        timestamp: new Date().toISOString(),
      });
    });
  }

  setReportGetter(getter: () => SimulationReport | null): void {
    this.reportGetter = getter;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    // Try API routes first
    const handled = await this.router.handle(req, res);
    if (handled) return;

    // Serve static UI files
    this.serveStatic(req, res);
  }

  private serveStatic(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    let pathname = url.pathname;

    // SPA: all non-API, non-file routes serve index.html
    if (pathname === "/" || !pathname.includes(".")) {
      pathname = "/index.html";
    }

    const filePath = join(this.uiDir, pathname);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";

    try {
      const content = readFileSync(filePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }

  private setupSocketHandlers(): void {
    this.io.on("connection", (socket) => {
      // Send initial snapshot on connect
      const active = this.worldRegistry.getActiveWorld();
      if (active) socket.emit("world:snapshot", this.buildSnapshot(active.engine));

      // Agent control commands
      socket.on("command:pause", (data) => {
        try {
          const current = this.worldRegistry.getActiveWorld();
          current?.engine.pauseAgent(data.agentId, data.reason);
        }
        catch (err) { socket.emit("error", { message: (err as Error).message }); }
      });

      socket.on("command:resume", (data) => {
        try {
          const current = this.worldRegistry.getActiveWorld();
          current?.engine.resumeAgent(data.agentId);
        }
        catch (err) { socket.emit("error", { message: (err as Error).message }); }
      });

      socket.on("command:stop", (data) => {
        try {
          const current = this.worldRegistry.getActiveWorld();
          current?.engine.stopAgent(data.agentId, data.reason);
        }
        catch (err) { socket.emit("error", { message: (err as Error).message }); }
      });

      socket.on("subscribe:agent", (agentId) => socket.join(`agent:${agentId}`));
      socket.on("unsubscribe:agent", (agentId) => socket.leave(`agent:${agentId}`));
      socket.on("subscribe:world", (worldId) => socket.join(`world:${worldId}`));
      socket.on("unsubscribe:world", (worldId) => socket.leave(`world:${worldId}`));
      socket.on("request:snapshot", () => {
        const current = this.worldRegistry.getActiveWorld();
        if (!current) return;
        socket.emit("world:snapshot", this.buildSnapshot(current.engine));
      });
    });
  }

  private buildSnapshot(engine: WorldEngine): WorldSnapshot {
    const ctx = engine.getContext();
    const statuses = engine.getAgentStatuses();
    const agents: AgentSnapshot[] = Object.entries(statuses).map(([id, status]) => {
      const agent = engine.getAgent(id);
      return {
        id,
        name: agent?.getProfile()?.name ?? id,
        role: agent?.role ?? "person",
        status,
        profile: agent?.getProfile(),
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
    return {
      worldId: ctx.worldId,
      status: engine.getStatus(),
      tick: ctx.tickCount,
      agents,
      recentEvents: [...engine.getEventLog()].slice(-100),
      timestamp: new Date().toISOString(),
    };
  }
}
