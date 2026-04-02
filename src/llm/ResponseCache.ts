import { createHash } from "node:crypto";
import type { LLMAdapter, ChatOptions, LLMResponse } from "./LLMAdapter.js";
import type { AgentMessage } from "../types/AgentTypes.js";
import type { AgentTool } from "../types/PluginTypes.js";

interface CacheEntry {
  response: LLMResponse;
  createdAtTick: number;
}

/**
 * LRU cache wrapper for LLMAdapter responses.
 * Caches chat/chatWithTools results by message content hash.
 * Entries expire after a configurable number of ticks.
 */
export class ResponseCache implements LLMAdapter {
  private inner: LLMAdapter;
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;
  private ttlTicks: number;
  private currentTick = 0;

  constructor(inner: LLMAdapter, maxSize = 500, ttlTicks = 5) {
    this.inner = inner;
    this.maxSize = maxSize;
    this.ttlTicks = ttlTicks;
  }

  setTick(tick: number): void {
    this.currentTick = tick;
    // Evict expired entries lazily (only when tick changes)
    if (this.cache.size > this.maxSize / 2) {
      for (const [key, entry] of this.cache) {
        if (this.currentTick - entry.createdAtTick > this.ttlTicks) {
          this.cache.delete(key);
        }
      }
    }
  }

  async chat(messages: AgentMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const key = this.hashKey(messages, options);
    const cached = this.getFromCache(key);
    if (cached) return cached;

    const response = await this.inner.chat(messages, options);
    this.putInCache(key, response);
    return response;
  }

  async chatWithTools(
    messages: AgentMessage[],
    tools: AgentTool[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    // Don't cache tool-calling responses (they have side effects)
    return this.inner.chatWithTools(messages, tools, options);
  }

  private getFromCache(key: string): LLMResponse | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (this.currentTick - entry.createdAtTick > this.ttlTicks) {
      this.cache.delete(key);
      return undefined;
    }

    // LRU: move to end
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.response;
  }

  private putInCache(key: string, response: LLMResponse): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { response, createdAtTick: this.currentTick });
  }

  private hashKey(messages: AgentMessage[], options?: ChatOptions): string {
    const hash = createHash("sha256");
    for (const msg of messages) {
      hash.update(msg.role);
      hash.update(msg.content);
    }
    if (options?.model) hash.update(options.model);
    if (options?.temperature != null) hash.update(String(options.temperature));
    return hash.digest("hex");
  }

  clear(): void {
    this.cache.clear();
  }
}
