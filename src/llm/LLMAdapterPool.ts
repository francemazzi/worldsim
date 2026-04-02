import type { LLMConfig } from "../types/WorldTypes.js";
import type { AgentConfig } from "../types/AgentTypes.js";
import type { LLMAdapter } from "./LLMAdapter.js";
import { OpenAICompatAdapter } from "./OpenAICompatAdapter.js";

/**
 * Manages a pool of LLM adapters, caching by config fingerprint.
 * Agents sharing the same LLM config share a single adapter instance.
 */
export class LLMAdapterPool {
  private worldConfig: LLMConfig;
  private pool: Map<string, LLMAdapter> = new Map();

  constructor(worldConfig: LLMConfig) {
    this.worldConfig = worldConfig;
  }

  /**
   * Returns an LLM adapter for the given agent config.
   * If the agent has a custom llm config, it's merged with the world config.
   * Adapters are cached by config fingerprint.
   */
  getAdapter(agentConfig: AgentConfig): LLMAdapter {
    const resolved = this.resolveConfig(agentConfig);
    const key = this.fingerprint(resolved);

    const existing = this.pool.get(key);
    if (existing) return existing;

    const adapter = new OpenAICompatAdapter(resolved);
    this.pool.set(key, adapter);
    return adapter;
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
    const agentLlm = agentConfig.llm;
    if (!agentLlm) return this.worldConfig;

    return {
      baseURL: agentLlm.baseURL ?? this.worldConfig.baseURL,
      apiKey: agentLlm.apiKey ?? this.worldConfig.apiKey,
      model: agentLlm.model ?? this.worldConfig.model,
      temperature: agentLlm.temperature ?? this.worldConfig.temperature,
      maxTokens: agentLlm.maxTokens ?? this.worldConfig.maxTokens,
    };
  }

  private fingerprint(config: LLMConfig): string {
    return `${config.baseURL}|${config.apiKey}|${config.model}`;
  }

  clear(): void {
    this.pool.clear();
  }
}
