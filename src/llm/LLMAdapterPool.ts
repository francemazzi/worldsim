import type { LLMConfig } from "../types/WorldTypes.js";
import type { AgentConfig } from "../types/AgentTypes.js";
import type { LLMAdapter } from "./LLMAdapter.js";
import { OpenAICompatAdapter } from "./OpenAICompatAdapter.js";
import { ResponseCache } from "./ResponseCache.js";

/**
 * Manages a pool of LLM adapters, caching by config fingerprint.
 * Agents sharing the same LLM config share a single adapter instance.
 */
export class LLMAdapterPool {
  private worldConfig: LLMConfig;
  private lightConfig: LLMConfig | undefined;
  private pool: Map<string, LLMAdapter> = new Map();
  private cacheEnabled: boolean;
  private cacheTtl: number;
  private caches: ResponseCache[] = [];

  constructor(worldConfig: LLMConfig, lightConfig?: LLMConfig, cacheEnabled = false, cacheTtl = 5) {
    this.worldConfig = worldConfig;
    this.lightConfig = lightConfig;
    this.cacheEnabled = cacheEnabled;
    this.cacheTtl = cacheTtl;
  }

  /**
   * Updates the current tick on all response caches.
   * Call at the start of each tick to enable TTL-based expiry.
   */
  setTick(tick: number): void {
    for (const cache of this.caches) {
      cache.setTick(tick);
    }
  }

  /**
   * Returns an LLM adapter for the given agent config.
   * Resolution order: agent.llm override > llmTier-based config > world config.
   * Adapters are cached by config fingerprint.
   */
  getAdapter(agentConfig: AgentConfig): LLMAdapter {
    const resolved = this.resolveConfig(agentConfig);
    const cacheKey = this.cacheEnabled
      ? `cached:${this.fingerprint(resolved)}`
      : this.fingerprint(resolved);

    const existing = this.pool.get(cacheKey);
    if (existing) return existing;

    const rawAdapter = new OpenAICompatAdapter(resolved);

    if (this.cacheEnabled) {
      const cached = new ResponseCache(rawAdapter, 500, this.cacheTtl);
      this.caches.push(cached);
      this.pool.set(cacheKey, cached);
      return cached;
    }

    this.pool.set(cacheKey, rawAdapter);
    return rawAdapter;
  }

  /**
   * Returns the world-level adapter (used for non-agent operations).
   */
  getWorldAdapter(): LLMAdapter {
    const key = this.fingerprint(this.worldConfig);
    const existing = this.pool.get(key);
    if (existing) return existing;

    const adapter = new OpenAICompatAdapter(this.worldConfig);
    this.pool.set(key, adapter);
    return adapter;
  }

  private resolveConfig(agentConfig: AgentConfig): LLMConfig {
    // Explicit per-agent llm config takes precedence
    const agentLlm = agentConfig.llm;
    if (agentLlm) {
      return {
        baseURL: agentLlm.baseURL ?? this.worldConfig.baseURL,
        apiKey: agentLlm.apiKey ?? this.worldConfig.apiKey,
        model: agentLlm.model ?? this.worldConfig.model,
        temperature: agentLlm.temperature ?? this.worldConfig.temperature,
        maxTokens: agentLlm.maxTokens ?? this.worldConfig.maxTokens,
      };
    }

    // llmTier: "light" uses the light config if available
    if (agentConfig.llmTier === "light" && this.lightConfig) {
      return this.lightConfig;
    }

    return this.worldConfig;
  }

  private fingerprint(config: LLMConfig): string {
    return `${config.baseURL}|${config.apiKey}|${config.model}`;
  }

  clear(): void {
    this.pool.clear();
  }
}
