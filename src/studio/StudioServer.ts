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
import type { WorldEngine } from "../engine/WorldEngine.js";
import type { SimulationReport } from "../types/ReportTypes.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
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

    // UI directory: at build time, static assets are copied to dist/studio/ui
    // __dirname works in CJS; import.meta.url in ESM
    let currentDir: string;
    try {
      currentDir = typeof __dirname !== "undefined" ? __dirname : fileURLToPath(new URL(".", import.meta.url));
    } catch {
      currentDir = process.cwd();
    }
    this.uiDir = join(currentDir, "ui");

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
    const getEngine = () => this.engine;
    const getCapabilities = () =>
      detectCapabilities(this.stores, !!this.engine);

    registerStoresApi(this.router, getCapabilities);
    registerAgentsApi(this.router, getEngine);
    registerEventsApi(this.router, getEngine);
    registerMemoryApi(this.router, () => this.stores.memoryStore);
    registerGraphApi(this.router, () => this.stores.graphStore, getEngine);
    registerPersistenceApi(this.router, () => this.stores.persistenceStore, getEngine);
    registerVectorApi(this.router, () => this.stores.vectorStore, () => this.stores.embeddingAdapter);
    if (this.reportGetter) {
      registerReportApi(this.router, this.reportGetter);
    }

    registerScenarioApi(
      this.router,
      () => this.scenarioPresets,
      async (scenarioConfig, llmConfig) => {
        try {
          if (this.engine) {
            return { started: false, error: "A simulation is already running." };
          }
          const result = loadScenario(scenarioConfig, llmConfig);
          this.engine = result.engine;
          this.stores = {
            memoryStore: result.memoryStore,
            graphStore: result.graphStore,
          };
          this.setReportGetter(result.getReport);

          // Wire events to Socket.IO
          this.setupEngineEvents(result.engine);

          // Start simulation (non-blocking)
          result.engine.start().then(() => {
            this.io.emit("world:status", { status: "stopped" });
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
    const agentNames = new Map<string, string>();
    const statuses = engine.getAgentStatuses();
    for (const id of Object.keys(statuses)) {
      const agent = engine.getAgent(id);
      if (agent) agentNames.set(id, agent.getProfile()?.name ?? id);
    }

    // Re-emit snapshot on new connections
    this.io.emit("world:status", { status: "running" });
  }

  setReportGetter(getter: () => SimulationReport | null): void {
    this.reportGetter = getter;
    registerReportApi(this.router, getter);
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
      if (this.engine) {
        const ctx = this.engine.getContext();
        const statuses = this.engine.getAgentStatuses();
        socket.emit("world:snapshot", {
          worldId: ctx.worldId,
          status: this.engine.getStatus(),
          tick: ctx.tickCount,
          agents: Object.entries(statuses).map(([id, status]) => {
            const agent = this.engine!.getAgent(id);
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
          }),
          recentEvents: [...this.engine.getEventLog()].slice(-100),
          timestamp: new Date().toISOString(),
        });
      }

      // Agent control commands
      socket.on("command:pause", (data) => {
        try { this.engine?.pauseAgent(data.agentId, data.reason); }
        catch (err) { socket.emit("error", { message: (err as Error).message }); }
      });

      socket.on("command:resume", (data) => {
        try { this.engine?.resumeAgent(data.agentId); }
        catch (err) { socket.emit("error", { message: (err as Error).message }); }
      });

      socket.on("command:stop", (data) => {
        try { this.engine?.stopAgent(data.agentId, data.reason); }
        catch (err) { socket.emit("error", { message: (err as Error).message }); }
      });

      socket.on("subscribe:agent", (agentId) => socket.join(`agent:${agentId}`));
      socket.on("unsubscribe:agent", (agentId) => socket.leave(`agent:${agentId}`));
      socket.on("request:snapshot", () => {
        if (!this.engine) return;
        const ctx = this.engine.getContext();
        const statuses = this.engine.getAgentStatuses();
        socket.emit("world:snapshot", {
          worldId: ctx.worldId,
          status: this.engine.getStatus(),
          tick: ctx.tickCount,
          agents: Object.entries(statuses).map(([id, status]) => {
            const agent = this.engine!.getAgent(id);
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
          }),
          recentEvents: [...this.engine.getEventLog()].slice(-100),
          timestamp: new Date().toISOString(),
        });
      });
    });
  }
}
