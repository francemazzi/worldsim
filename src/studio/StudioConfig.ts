import type { WorldEngine } from "../engine/WorldEngine.js";
import type { MemoryStore } from "../types/MemoryTypes.js";
import type { GraphStore } from "../types/GraphTypes.js";
import type { VectorStore, EmbeddingAdapter } from "../types/VectorTypes.js";
import type { PersistenceStore } from "../types/PersistenceTypes.js";
import type { SimulationReport } from "../types/ReportTypes.js";

export interface StudioOptions {
  /** Reference to the WorldEngine instance. Required for live mode. */
  engine: WorldEngine;
  /** Port for the Studio HTTP server. Default: 4400. */
  port?: number;
  /** Auto-open browser on start. Default: true. */
  open?: boolean;
  /** CORS origin. Default: "*". */
  corsOrigin?: string | string[];

  // Optional stores — pass the same ones from your WorldConfig
  memoryStore?: MemoryStore;
  graphStore?: GraphStore;
  vectorStore?: VectorStore;
  embeddingAdapter?: EmbeddingAdapter;
  persistenceStore?: PersistenceStore;

  /** Optional report getter from ReportGeneratorPlugin. Enables the Report page in Studio. */
  reportGetter?: () => SimulationReport | null;
}

export interface StudioCliConfig {
  port?: number;
  stores?: {
    neo4j?: { uri: string; user: string; password: string };
    postgres?: { connectionString: string };
    redis?: { url: string };
  };
}

export const STUDIO_DEFAULTS = {
  port: 4400,
  open: true,
  corsOrigin: "*" as string | string[],
} as const;
