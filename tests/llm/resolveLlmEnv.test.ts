import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LLM_MODEL,
  OPENAI_BASE_URL,
  OPENROUTER_BASE_URL,
  hasLlmApiKey,
  resolveLlmEnv,
} from "../../src/llm/resolveLlmEnv.js";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "LLM_BASE_URL",
  "LLM_MODEL",
  "OPENROUTER_HTTP_REFERER",
  "OPENROUTER_APP_NAME",
] as const;

function clearEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

describe("resolveLlmEnv", () => {
  afterEach(() => {
    clearEnv();
  });

  it("returns null when no API key is configured", () => {
    expect(resolveLlmEnv()).toBeNull();
    expect(hasLlmApiKey()).toBe(false);
  });

  it("resolves OpenAI credentials from OPENAI_API_KEY", () => {
    process.env.OPENAI_API_KEY = "sk-openai";

    expect(resolveLlmEnv()).toEqual({
      baseURL: OPENAI_BASE_URL,
      apiKey: "sk-openai",
      model: DEFAULT_LLM_MODEL,
    });
    expect(hasLlmApiKey()).toBe(true);
  });

  it("resolves OpenRouter credentials from OPENROUTER_API_KEY", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";

    expect(resolveLlmEnv()).toEqual({
      baseURL: OPENROUTER_BASE_URL,
      apiKey: "sk-or-v1-test",
      model: DEFAULT_LLM_MODEL,
    });
  });

  it("prefers OPENROUTER_API_KEY over OPENAI_API_KEY", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    process.env.OPENAI_API_KEY = "sk-openai";

    const config = resolveLlmEnv();
    expect(config?.apiKey).toBe("sk-or-v1-test");
    expect(config?.baseURL).toBe(OPENROUTER_BASE_URL);
  });

  it("uses explicit overrides over environment variables", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    process.env.LLM_BASE_URL = "https://ignored.example/v1";
    process.env.LLM_MODEL = "ignored-model";

    expect(
      resolveLlmEnv({
        apiKey: "override-key",
        baseURL: "https://custom.example/v1",
        model: "custom-model",
      }),
    ).toEqual({
      baseURL: "https://custom.example/v1",
      apiKey: "override-key",
      model: "custom-model",
    });
  });

  it("respects LLM_BASE_URL and LLM_MODEL env overrides", () => {
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.LLM_BASE_URL = "https://proxy.example/v1";
    process.env.LLM_MODEL = "gpt-4o";

    expect(resolveLlmEnv()).toEqual({
      baseURL: "https://proxy.example/v1",
      apiKey: "sk-openai",
      model: "gpt-4o",
    });
  });

  it("injects OpenRouter headers from env when using OpenRouter key", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    process.env.OPENROUTER_HTTP_REFERER = "https://github.com/francemazzi/worldsim";
    process.env.OPENROUTER_APP_NAME = "worldsim";

    expect(resolveLlmEnv()).toEqual({
      baseURL: OPENROUTER_BASE_URL,
      apiKey: "sk-or-v1-test",
      model: DEFAULT_LLM_MODEL,
      headers: {
        "HTTP-Referer": "https://github.com/francemazzi/worldsim",
        "X-Title": "worldsim",
      },
    });
  });

  it("merges override headers without clobbering explicit values", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-v1-test";
    process.env.OPENROUTER_HTTP_REFERER = "https://ignored.example";
    process.env.OPENROUTER_APP_NAME = "ignored";

    expect(
      resolveLlmEnv({
        headers: {
          "HTTP-Referer": "https://custom.example",
          "X-Custom": "value",
        },
      }),
    ).toEqual({
      baseURL: OPENROUTER_BASE_URL,
      apiKey: "sk-or-v1-test",
      model: DEFAULT_LLM_MODEL,
      headers: {
        "HTTP-Referer": "https://custom.example",
        "X-Custom": "value",
        "X-Title": "ignored",
      },
    });
  });

  it("does not inject OpenRouter headers for OpenAI keys", () => {
    process.env.OPENAI_API_KEY = "sk-openai";
    process.env.OPENROUTER_HTTP_REFERER = "https://github.com/francemazzi/worldsim";
    process.env.OPENROUTER_APP_NAME = "worldsim";

    expect(resolveLlmEnv()).toEqual({
      baseURL: OPENAI_BASE_URL,
      apiKey: "sk-openai",
      model: DEFAULT_LLM_MODEL,
    });
  });
});
