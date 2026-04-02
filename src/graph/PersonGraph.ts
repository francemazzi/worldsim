import type { LLMAdapter } from "../llm/LLMAdapter.js";
import type { AgentTool } from "../types/PluginTypes.js";
import type { WorldContext } from "../types/WorldTypes.js";
import { buildAgentGraph } from "./AgentGraph.js";

export function buildPersonGraph(config: {
  llm: LLMAdapter;
  tools: AgentTool[];
  maxIterations: number;
  worldContext: WorldContext;
}) {
  return buildAgentGraph({
    llm: config.llm,
    tools: config.tools,
    maxIterations: config.maxIterations,
    worldContext: config.worldContext,
  });
}
