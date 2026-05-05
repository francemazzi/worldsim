import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AgentMessage } from "../types/AgentTypes.js";
import type { AgentTool } from "../types/PluginTypes.js";
import type { LLMConfig } from "../types/WorldTypes.js";
import type { LLMAdapter, LLMResponse, ChatOptions, ToolCall } from "./LLMAdapter.js";

const TRANSIENT_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenAICompatAdapter implements LLMAdapter {
  private client: OpenAI;
  private defaultModel: string;
  private defaultTemperature: number | undefined;
  private defaultMaxTokens: number | undefined;
  private retry: RetryConfig;

  constructor(config: LLMConfig) {
    this.client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    });
    this.defaultModel = config.model;
    this.defaultTemperature = config.temperature;
    this.defaultMaxTokens = config.maxTokens;
    this.retry = {
      maxRetries: config.maxRetries ?? 3,
      initialDelayMs: config.retryInitialDelayMs ?? 500,
      maxDelayMs: config.retryMaxDelayMs ?? 8_000,
      backoffFactor: config.retryBackoffFactor ?? 2,
    };
  }

  async chat(
    messages: AgentMessage[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const response = await this.withRetry(() => this.client.chat.completions.create({
      model: options?.model ?? this.defaultModel,
      messages: this.convertMessages(messages),
      temperature: (options?.temperature ?? this.defaultTemperature) ?? null,
      max_tokens: (options?.maxTokens ?? this.defaultMaxTokens) ?? null,
    }));

    const choice = response.choices[0];
    return {
      content: choice?.message?.content ?? "",
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }

  async chatWithTools(
    messages: AgentMessage[],
    tools: AgentTool[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const openaiTools = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));

    const response = await this.withRetry(() => this.client.chat.completions.create({
      model: options?.model ?? this.defaultModel,
      messages: this.convertMessages(messages),
      tools: openaiTools,
      temperature: (options?.temperature ?? this.defaultTemperature) ?? null,
      max_tokens: (options?.maxTokens ?? this.defaultMaxTokens) ?? null,
    }));

    const choice = response.choices[0];
    const toolCalls: ToolCall[] | undefined =
      choice?.message?.tool_calls
        ?.filter((tc) => tc.type === "function")
        .map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
        }));

    return {
      content: choice?.message?.content ?? "",
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens ?? 0,
          }
        : undefined,
    };
  }

  async *chatStream(
    messages: AgentMessage[],
    options?: ChatOptions,
  ): AsyncIterable<string> {
    const stream = await this.withRetry(() => this.client.chat.completions.create({
      model: options?.model ?? this.defaultModel,
      messages: this.convertMessages(messages),
      temperature: (options?.temperature ?? this.defaultTemperature) ?? null,
      max_tokens: (options?.maxTokens ?? this.defaultMaxTokens) ?? null,
      stream: true,
    }));

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (err) {
        if (!this.shouldRetry(err, attempt)) throw err;

        await sleep(this.getRetryDelayMs(err, attempt));
        attempt++;
      }
    }
  }

  private shouldRetry(err: unknown, attempt: number): boolean {
    if (attempt >= this.retry.maxRetries) return false;

    const status = this.getStatusCode(err);
    return status !== undefined && TRANSIENT_STATUS_CODES.has(status);
  }

  private getRetryDelayMs(err: unknown, attempt: number): number {
    const retryAfterMs = this.getRetryAfterMs(err);
    if (retryAfterMs !== undefined) {
      return Math.min(retryAfterMs, this.retry.maxDelayMs);
    }

    const exponentialDelay = this.retry.initialDelayMs
      * (this.retry.backoffFactor ** attempt);
    const jitter = Math.random() * Math.min(100, exponentialDelay * 0.2);
    return Math.min(exponentialDelay + jitter, this.retry.maxDelayMs);
  }

  private getStatusCode(err: unknown): number | undefined {
    if (!err || typeof err !== "object") return undefined;

    const maybeStatus = (err as { status?: unknown; statusCode?: unknown }).status
      ?? (err as { status?: unknown; statusCode?: unknown }).statusCode;
    return typeof maybeStatus === "number" ? maybeStatus : undefined;
  }

  private getRetryAfterMs(err: unknown): number | undefined {
    if (!err || typeof err !== "object") return undefined;

    const headers = (err as { headers?: unknown }).headers;
    const retryAfter = this.readHeader(headers, "retry-after");
    if (!retryAfter) return undefined;

    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const dateMs = Date.parse(retryAfter);
    if (Number.isNaN(dateMs)) return undefined;

    return Math.max(0, dateMs - Date.now());
  }

  private readHeader(headers: unknown, name: string): string | undefined {
    if (!headers || typeof headers !== "object") return undefined;

    if ("get" in headers && typeof headers.get === "function") {
      const value = headers.get(name);
      return typeof value === "string" ? value : undefined;
    }

    const record = headers as Record<string, unknown>;
    const value = record[name] ?? record[name.toLowerCase()];
    return typeof value === "string" ? value : undefined;
  }

  private convertMessages(
    messages: AgentMessage[],
  ): ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool" as const,
          content: m.content,
          tool_call_id: m.toolCallId ?? "",
        };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "assistant" as const,
          content: m.content,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          })),
        };
      }
      return {
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      };
    });
  }
}
