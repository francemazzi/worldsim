import type { AgentMessage } from "../src/types/AgentTypes.js";
import type { AgentTool } from "../src/types/PluginTypes.js";
import type { LLMAdapter, LLMResponse, ChatOptions } from "../src/llm/LLMAdapter.js";
import { WorldEngine } from "../src/engine/WorldEngine.js";
import type { WorldConfig, LLMConfig } from "../src/types/WorldTypes.js";
import { InMemoryGraphStore } from "../tests/helpers/InMemoryGraphStore.js";
import { InMemoryMemoryStore } from "../tests/helpers/InMemoryMemoryStore.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── BenchmarkLLMAdapter (mock with simulated latency) ───

export class BenchmarkLLMAdapter implements LLMAdapter {
  private _callCount = 0;
  private _maxConcurrent = 0;
  private _running = 0;
  private delayMs: number;

  constructor(delayMs = 5) {
    this.delayMs = delayMs;
  }

  async chat(
    _messages: AgentMessage[],
    _options?: ChatOptions,
  ): Promise<LLMResponse> {
    this._running++;
    if (this._running > this._maxConcurrent) {
      this._maxConcurrent = this._running;
    }
    this._callCount++;
    if (this.delayMs > 0) await sleep(this.delayMs);
    this._running--;
    return {
      content: '{"actionType":"speak","content":"benchmark response"}',
      usage: { inputTokens: 500, outputTokens: 100 },
    };
  }

  async chatWithTools(
    messages: AgentMessage[],
    _tools: AgentTool[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    return this.chat(messages, options);
  }

  get callCount(): number {
    return this._callCount;
  }

  get maxConcurrent(): number {
    return this._maxConcurrent;
  }

  reset(): void {
    this._callCount = 0;
    this._maxConcurrent = 0;
    this._running = 0;
  }
}

// ─── InstrumentedLLMAdapter (wraps real LLM with stats) ───

export interface LLMStats {
  calls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  latencies: number[];
  validJsonCount: number;
  fallbackCount: number;
}

export class InstrumentedLLMAdapter implements LLMAdapter {
  private inner: LLMAdapter;
  private _stats: LLMStats = {
    calls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    latencies: [],
    validJsonCount: 0,
    fallbackCount: 0,
  };

  constructor(inner: LLMAdapter) {
    this.inner = inner;
  }

  async chat(
    messages: AgentMessage[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const start = performance.now();
    const result = await this.inner.chat(messages, options);
    this.recordCall(result, performance.now() - start);
    return result;
  }

  async chatWithTools(
    messages: AgentMessage[],
    tools: AgentTool[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const start = performance.now();
    const result = await this.inner.chatWithTools(messages, tools, options);
    this.recordCall(result, performance.now() - start);
    return result;
  }

  private recordCall(result: LLMResponse, latencyMs: number): void {
    this._stats.calls++;
    this._stats.latencies.push(latencyMs);
    if (result.usage) {
      this._stats.totalInputTokens += result.usage.inputTokens;
      this._stats.totalOutputTokens += result.usage.outputTokens;
    }
    try {
      const match = result.content.match(/\{[\s\S]*\}/);
      if (match) {
        JSON.parse(match[0]);
        this._stats.validJsonCount++;
      } else {
        this._stats.fallbackCount++;
      }
    } catch {
      this._stats.fallbackCount++;
    }
  }

  get stats(): Readonly<LLMStats> {
    return this._stats;
  }

  reset(): void {
    this._stats = {
      calls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      latencies: [],
      validJsonCount: 0,
      fallbackCount: 0,
    };
  }
}

// ─── Benchmark Engine Factory ───

export interface BenchEngineOptions {
  agents: number;
  ticks: number;
  maxConcurrent?: number;
  neighborhood?: boolean;
  schedule?: boolean;
  llmDelayMs?: number;
}

export interface BenchEngineResult {
  engine: WorldEngine;
  llm: BenchmarkLLMAdapter;
}

const PERSONALITIES = [
  "curiosa", "scettica", "entusiasta", "cauta", "innovativa",
  "pragmatica", "idealista", "analitica", "creativa", "riflessiva",
];

const PROFESSIONS = [
  "ingegnere", "medico", "insegnante", "artista", "scienziato",
  "avvocato", "architetto", "giornalista", "musicista", "filosofo",
];

export function createBenchEngine(opts: BenchEngineOptions): BenchEngineResult {
  const llm = new BenchmarkLLMAdapter(opts.llmDelayMs ?? 5);

  const config: WorldConfig = {
    worldId: `bench-${opts.agents}-${Date.now()}`,
    maxTicks: opts.ticks,
    tickIntervalMs: 0,
    maxConcurrentAgents: opts.maxConcurrent,
    llm: {
      baseURL: "http://mock",
      apiKey: "mock-key",
      model: "mock-model",
    },
    memoryStore: new InMemoryMemoryStore(),
    graphStore: new InMemoryGraphStore(),
  };

  // Monkey-patch the engine to use our mock LLM
  const engine = new WorldEngine(config);
  // @ts-expect-error Accessing private field for benchmark
  engine.llmPool = {
    getAdapter: () => llm,
    getWorldAdapter: () => llm,
    clear: () => {},
  };

  // Create groups for neighborhood
  const groupCount = Math.max(1, Math.floor(opts.agents / 20));
  const groups: string[][] = Array.from({ length: groupCount }, () => []);

  for (let i = 0; i < opts.agents; i++) {
    const groupIdx = i % groupCount;
    const groupId = `group-${groupIdx}`;
    groups[groupIdx]!.push(`agent-${i}`);

    engine.addAgent({
      id: `agent-${i}`,
      role: "person",
      name: `Agent ${i}`,
      iterationsPerTick: 1,
      profile: {
        name: `Agent ${i}`,
        personality: [PERSONALITIES[i % PERSONALITIES.length]!],
        goals: i % 3 === 0 ? ["esplorare il mondo"] : [],
        profession: PROFESSIONS[i % PROFESSIONS.length],
      },
      initialState: {
        mood: "neutral",
        energy: 50 + (i % 50),
        goals: i % 3 === 0 ? ["esplorare il mondo"] : [],
      },
      ...(opts.neighborhood
        ? {
            neighborhood: {
              maxContacts: 10,
              groups: [groupId],
            },
          }
        : {}),
      ...(opts.schedule
        ? {
            schedule: {
              activeTickRatio: 0.3,
              sleepCycle: {
                activeFrom: 0,
                activeTo: 6,
                period: 10,
              },
            },
          }
        : {}),
    });
  }

  return { engine, llm };
}

// ─── Report Utilities ───

export function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)]!;
}

export function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function formatMs(ms: number): string {
  return `${Math.round(ms)}ms`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return `${n}`;
}

export function formatCost(inputTokens: number, outputTokens: number): string {
  // gpt-4o-mini pricing: $0.15/1M input, $0.60/1M output
  const cost = (inputTokens * 0.15 + outputTokens * 0.60) / 1_000_000;
  return `$${cost.toFixed(4)}`;
}

export function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
