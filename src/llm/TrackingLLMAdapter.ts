import type { LLMAdapter, ChatOptions, LLMResponse } from "./LLMAdapter.js";
import type { AgentMessage } from "../types/AgentTypes.js";
import type { AgentTool } from "../types/PluginTypes.js";
import type { TokenBudgetTracker } from "../scheduling/TokenBudgetTracker.js";

/**
 * Decorator that records token usage from LLM responses into the TokenBudgetTracker.
 */
export class TrackingLLMAdapter implements LLMAdapter {
  constructor(
    private inner: LLMAdapter,
    private agentId: string,
    private tracker: TokenBudgetTracker,
  ) {}

  async chat(messages: AgentMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const response = await this.inner.chat(messages, options);
    this.recordUsage(response);
    return response;
  }

  async chatWithTools(
    messages: AgentMessage[],
    tools: AgentTool[],
    options?: ChatOptions,
  ): Promise<LLMResponse> {
    const response = await this.inner.chatWithTools(messages, tools, options);
    this.recordUsage(response);
    return response;
  }

  private recordUsage(response: LLMResponse): void {
    if (response.usage) {
      this.tracker.record(this.agentId, response.usage);
    }
  }
}
