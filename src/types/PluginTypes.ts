import type { WorldContext, WorldEvent } from "./WorldTypes.js";
import type {
  AgentAction,
  AgentState,
  AgentStatus,
  AgentControlEvent,
} from "./AgentTypes.js";
import type { RulesContext } from "./RulesTypes.js";
import type { CrossWorldEnvelope } from "../federation/types.js";
import type { Stimulus } from "./StimulusTypes.js";
import type { Percept } from "./PerceptionTypes.js";
import type { NeedsState } from "./NeedsTypes.js";
import type { MessageDeliveryReceipt } from "../messaging/Message.js";

export type CrossWorldMessageDirection = "inbound" | "outbound";

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
  /**
   * Observes the final routing outcome after a message has been delivered or
   * deliberately dropped. The receipt is informational and cannot mutate or
   * duplicate delivery.
   */
  onMessageRouted?: ((
    receipt: MessageDeliveryReceipt,
    ctx: WorldContext,
  ) => Promise<void>) | undefined;
  /**
   * Fires for every cross-world envelope the local FederationBus handles.
   * `direction` is `"outbound"` when the envelope is leaving the local world
   * and `"inbound"` when it has just been received and validated.
   */
  onCrossWorldMessage?: ((
    envelope: CrossWorldEnvelope,
    direction: CrossWorldMessageDirection,
  ) => Promise<void>) | undefined;
  /**
   * Realistic Simulation hook (Phase 1+).
   *
   * Fires whenever a stimulus is published on the StimulusBus. Plugins may
   * inspect or transform the stimulus before it reaches the perception
   * engine. Returning `null` cancels the emission.
   */
  onStimulusEmit?: ((
    stimulus: Stimulus,
    ctx: WorldContext,
  ) => Promise<Stimulus | null>) | undefined;
  /**
   * Realistic Simulation hook (Phase 1+).
   *
   * Fires after the PerceptionEngine has resolved which percepts an agent
   * receives in a tick, but before attention scoring. Plugins can inspect
   * or filter the percept array (e.g. occlusion, language modulation).
   */
  onPerceptDelivered?: ((
    agentId: string,
    percepts: Percept[],
    ctx: WorldContext,
  ) => Promise<Percept[]>) | undefined;
  /**
   * Realistic Simulation hook (Phase 4).
   *
   * Fires once per tick per agent that has a `NeedsState`. Lets plugins
   * apply external effects (a meal reduces hunger, fatigue grows in heat).
   */
  onNeedsTick?: ((
    agentId: string,
    needs: NeedsState,
    ctx: WorldContext,
  ) => Promise<NeedsState>) | undefined;
  tools?: AgentTool[] | undefined;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: unknown, ctx: WorldContext): Promise<unknown>;
}
