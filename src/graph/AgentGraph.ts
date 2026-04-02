import { Annotation, StateGraph, START, END } from "@langchain/langgraph";
import type { LLMAdapter, ToolCall } from "../llm/LLMAdapter.js";
import type { AgentTool } from "../types/PluginTypes.js";
import type { AgentMessage } from "../types/AgentTypes.js";
import type { WorldContext } from "../types/WorldTypes.js";

export const AgentStateAnnotation = Annotation.Root({
  messages: Annotation<AgentMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  loopCount: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  shouldFinish: Annotation<boolean>({
    reducer: (_prev, next) => next,
    default: () => false,
  }),
  toolResults: Annotation<unknown[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  pendingToolCalls: Annotation<ToolCall[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
});

export type AgentGraphState = typeof AgentStateAnnotation.State;

export interface AgentGraphConfig {
  llm: LLMAdapter;
  tools: AgentTool[];
  maxIterations: number;
  worldContext: WorldContext;
}

function shouldContinue(state: AgentGraphState): "execute_tool" | typeof END {
  if (state.shouldFinish || state.loopCount >= 10) return END;
  if (state.pendingToolCalls.length > 0) return "execute_tool";
  return END;
}

export function buildAgentGraph(config: AgentGraphConfig) {
  const { llm, tools, maxIterations, worldContext } = config;
  const toolMap = new Map(tools.map((t) => [t.name, t]));

  async function think(
    state: AgentGraphState,
  ): Promise<Partial<AgentGraphState>> {
    if (state.loopCount >= maxIterations) {
      return { shouldFinish: true };
    }

    const response = tools.length > 0
      ? await llm.chatWithTools(state.messages, tools)
      : await llm.chat(state.messages);

    if (response.toolCalls?.length) {
      const assistantMsg: AgentMessage = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        })),
      };
      return {
        messages: [assistantMsg],
        pendingToolCalls: response.toolCalls,
        loopCount: state.loopCount + 1,
      };
    }

    return {
      messages: [{ role: "assistant" as const, content: response.content }],
      shouldFinish: true,
      loopCount: state.loopCount + 1,
      pendingToolCalls: [],
    };
  }

  async function executeTool(
    state: AgentGraphState,
  ): Promise<Partial<AgentGraphState>> {
    const results: unknown[] = [];
    const newMessages: AgentMessage[] = [];

    for (const tc of state.pendingToolCalls) {
      const tool = toolMap.get(tc.name);
      if (!tool) {
        const errMsg = `Tool "${tc.name}" not found`;
        results.push({ error: errMsg });
        newMessages.push({
          role: "tool",
          content: errMsg,
          toolCallId: tc.id,
          name: tc.name,
        });
        continue;
      }

      try {
        const result = await tool.execute(tc.arguments, worldContext);
        results.push(result);
        newMessages.push({
          role: "tool",
          content: typeof result === "string" ? result : JSON.stringify(result),
          toolCallId: tc.id,
          name: tc.name,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        results.push({ error: errMsg });
        newMessages.push({
          role: "tool",
          content: `Error: ${errMsg}`,
          toolCallId: tc.id,
          name: tc.name,
        });
      }
    }

    return {
      messages: newMessages,
      toolResults: results,
      pendingToolCalls: [],
    };
  }

  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("think", think)
    .addNode("execute_tool", executeTool)
    .addEdge(START, "think")
    .addConditionalEdges("think", shouldContinue)
    .addEdge("execute_tool", "think")
    .compile();

  return graph;
}
