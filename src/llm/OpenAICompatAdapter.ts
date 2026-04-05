import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { AgentMessage } from "../types/AgentTypes.js";
import type { AgentTool } from "../types/PluginTypes.js";
import type { LLMConfig } from "../types/WorldTypes.js";
import type { LLMAdapter, LLMResponse, ChatOptions, ToolCall } from "./LLMAdapter.js";

export class OpenAICompatAdapter implements LLMAdapter {
  private client: OpenAI;
  private defaultModel: string;
  private defaultTemperature: number | undefined;
  private defaultMaxTokens: number | undefined;

  constructor(config: LLMConfig) {
    this.client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
    });
    this.defaultModel = config.model;
    this.defaultTemperature = config.temperature;
    this.defaultMaxTokens = config.maxTokens;
  }

  async chat(
    messages: AgentMessage[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: options?.model ?? this.defaultModel,
      messages: this.convertMessages(messages),
      temperature: (options?.temperature ?? this.defaultTemperature) ?? null,
      max_tokens: (options?.maxTokens ?? this.defaultMaxTokens) ?? null,
    });

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

    const response = await this.client.chat.completions.create({
      model: options?.model ?? this.defaultModel,
      messages: this.convertMessages(messages),
      tools: openaiTools,
      temperature: (options?.temperature ?? this.defaultTemperature) ?? null,
      max_tokens: (options?.maxTokens ?? this.defaultMaxTokens) ?? null,
    });

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
    const stream = await this.client.chat.completions.create({
      model: options?.model ?? this.defaultModel,
      messages: this.convertMessages(messages),
      temperature: (options?.temperature ?? this.defaultTemperature) ?? null,
      max_tokens: (options?.maxTokens ?? this.defaultMaxTokens) ?? null,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
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
