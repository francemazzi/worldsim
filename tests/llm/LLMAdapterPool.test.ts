import { describe, it, expect } from "vitest";
import { LLMAdapterPool } from "../../src/llm/LLMAdapterPool.js";
import type { AgentConfig } from "../../src/types/AgentTypes.js";

const worldConfig = {
  baseURL: "https://api.openai.com/v1",
  apiKey: "world-key",
  model: "gpt-4",
  temperature: 0.7,
};

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "agent-1",
    role: "person",
    name: "Test Agent",
    ...overrides,
  };
}

describe("LLMAdapterPool", () => {
  it("returns world adapter when agent has no custom llm config", () => {
    const pool = new LLMAdapterPool(worldConfig);
    const adapter = pool.getAdapter(makeAgentConfig());
    const worldAdapter = pool.getWorldAdapter();
    expect(adapter).toBe(worldAdapter);
  });

  it("returns different adapter when agent has custom api key", () => {
    const pool = new LLMAdapterPool(worldConfig);
    const adapter = pool.getAdapter(
      makeAgentConfig({ llm: { apiKey: "agent-key" } }),
    );
    const worldAdapter = pool.getWorldAdapter();
    expect(adapter).not.toBe(worldAdapter);
  });

  it("caches adapters with same config fingerprint", () => {
    const pool = new LLMAdapterPool(worldConfig);
    const config = makeAgentConfig({ llm: { apiKey: "custom-key" } });
    const adapter1 = pool.getAdapter(config);
    const adapter2 = pool.getAdapter(config);
    expect(adapter1).toBe(adapter2);
  });

  it("shares adapter between agents with same llm config", () => {
    const pool = new LLMAdapterPool(worldConfig);
    const adapter1 = pool.getAdapter(
      makeAgentConfig({ id: "a1", llm: { apiKey: "shared-key" } }),
    );
    const adapter2 = pool.getAdapter(
      makeAgentConfig({ id: "a2", llm: { apiKey: "shared-key" } }),
    );
    expect(adapter1).toBe(adapter2);
  });

  it("creates separate adapters for different models", () => {
    const pool = new LLMAdapterPool(worldConfig);
    const adapter1 = pool.getAdapter(
      makeAgentConfig({ id: "a1", llm: { model: "gpt-4" } }),
    );
    const adapter2 = pool.getAdapter(
      makeAgentConfig({ id: "a2", llm: { model: "claude-3" } }),
    );
    expect(adapter1).not.toBe(adapter2);
  });

  it("merges partial config with world defaults", () => {
    const pool = new LLMAdapterPool(worldConfig);
    // Agent only overrides model, should still get world's baseURL and apiKey
    const adapter = pool.getAdapter(
      makeAgentConfig({ llm: { model: "gpt-3.5" } }),
    );
    // The adapter is distinct because the model differs
    const worldAdapter = pool.getWorldAdapter();
    expect(adapter).not.toBe(worldAdapter);
  });
});
