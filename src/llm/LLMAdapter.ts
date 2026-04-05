import type { AgentMessage } from "../types/AgentTypes.js";
import type { AgentTool } from "../types/PluginTypes.js";

export interface ChatOptions {
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  model?: string | undefined;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[] | undefined;
  usage?: { inputTokens: number; outputTokens: number } | undefined;
}

export interface LLMAdapter {
  chat(messages: AgentMessage[], options?: ChatOptions): Promise<LLMResponse>;
  chatWithTools(
    messages: AgentMessage[],
    tools: AgentTool[],
    options?: ChatOptions,
  ): Promise<LLMResponse>;
  /**
   * Stream a chat completion, yielding text chunks as they arrive.
   * Optional — callers should check availability before using.
   */
  chatStream?(
    messages: AgentMessage[],
    options?: ChatOptions,
  ): AsyncIterable<string>;
}
