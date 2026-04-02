import type { AgentAction, AgentState } from "../../types/AgentTypes.js";

export type OnAgentActionHook = (
  action: AgentAction,
  state: AgentState,
) => Promise<AgentAction>;
