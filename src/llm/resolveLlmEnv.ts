import type { LLMConfig } from "../types/WorldTypes.js";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_LLM_MODEL = "gpt-4o-mini";

export interface ResolveLlmEnvOptions {
  apiKey?: string | undefined;
  baseURL?: string | undefined;
  model?: string | undefined;
  headers?: Record<string, string> | undefined;
}

function resolveApiKey(overrides?: ResolveLlmEnvOptions): {
  apiKey: string | undefined;
  fromOpenRouter: boolean;
} {
  if (overrides?.apiKey) {
    return { apiKey: overrides.apiKey, fromOpenRouter: false };
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    return { apiKey: openRouterKey, fromOpenRouter: true };
  }

  const openAiKey = process.env.OPENAI_API_KEY;
  if (openAiKey) {
    return { apiKey: openAiKey, fromOpenRouter: false };
  }

  return { apiKey: undefined, fromOpenRouter: false };
}

function resolveBaseURL(
  overrides: ResolveLlmEnvOptions | undefined,
  fromOpenRouter: boolean,
): string {
  if (overrides?.baseURL) return overrides.baseURL;
  if (process.env.LLM_BASE_URL) return process.env.LLM_BASE_URL;
  return fromOpenRouter ? OPENROUTER_BASE_URL : OPENAI_BASE_URL;
}

function resolveOpenRouterHeaders(
  overrides: ResolveLlmEnvOptions | undefined,
  fromOpenRouter: boolean,
): Record<string, string> | undefined {
  const headers: Record<string, string> = { ...overrides?.headers };

  if (fromOpenRouter) {
    const referer = process.env.OPENROUTER_HTTP_REFERER;
    const appName = process.env.OPENROUTER_APP_NAME;
    if (referer && !headers["HTTP-Referer"]) {
      headers["HTTP-Referer"] = referer;
    }
    if (appName && !headers["X-Title"]) {
      headers["X-Title"] = appName;
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function resolveLlmEnv(overrides?: ResolveLlmEnvOptions): LLMConfig | null {
  const { apiKey, fromOpenRouter } = resolveApiKey(overrides);
  if (!apiKey) return null;

  const baseURL = resolveBaseURL(overrides, fromOpenRouter);
  const model = overrides?.model ?? process.env.LLM_MODEL ?? DEFAULT_LLM_MODEL;
  const headers = resolveOpenRouterHeaders(overrides, fromOpenRouter);

  return {
    baseURL,
    apiKey,
    model,
    ...(headers ? { headers } : {}),
  };
}

export function hasLlmApiKey(): boolean {
  return resolveLlmEnv() !== null;
}
