import type { WorldContext, WorldEvent } from "./WorldTypes.js";
import type {
  AgentAction,
  AgentState,
  AgentStatus,
  AgentControlEvent,
} from "./AgentTypes.js";
import type { RulesContext } from "./RulesTypes.js";

export interface WorldSimPlugin {
  name: string;
  version: string;
  /** If true, hooks on this plugin can run in parallel with other parallel plugins. Default false. */
  parallel?: boolean | undefined;
  onBootstrap?: ((ctx: WorldContext, rules: RulesContext) => Promise<void>) | undefined;
  onWorldTick?: ((tick: number, ctx: WorldContext) => Promise<void>) | undefined;
  onAgentAction?: ((
    action: AgentAction,
    state: AgentState,
  ) => Promise<AgentAction>) | undefined;
  /**
   * Batch hook: called once with all actions from the tick.
   * If implemented, `onAgentAction` is NOT called for this plugin.
   * More efficient for plugins that process multiple actions (logging, analytics).
   */
  onAgentActionsBatch?: ((
    actions: AgentAction[],
    ctx: WorldContext,
  ) => Promise<void>) | undefined;
  onRulesLoaded?: ((rules: RulesContext) => Promise<void>) | undefined;
  onWorldStop?: ((ctx: WorldContext, events: WorldEvent[]) => Promise<void>) | undefined;
  onAgentStatusChange?: ((
    event: AgentControlEvent,
    oldStatus: AgentStatus,
    newStatus: AgentStatus,
  ) => Promise<void>) | undefined;
  tools?: AgentTool[] | undefined;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown, ctx: WorldContext): Promise<unknown>;
}
