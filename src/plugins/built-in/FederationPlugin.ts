import type { WorldSimPlugin, AgentTool } from "../../types/PluginTypes.js";
import type { MessageBus } from "../../messaging/MessageBus.js";
import { createSendCrossWorldMessageTool } from "../../agents/tools/sendCrossWorldMessage.js";

export interface FederationPluginOptions {
  worldId: string;
  messageBus: MessageBus;
}

/**
 * Built-in plugin auto-registered by `WorldEngine` when the world joins a
 * federation (`config.federation` is set). Exposes the agent tools that
 * deal with cross-world communication. Future phases add `lookup_agent`
 * (Phase 2), `initiate_call`/`respond_to_call`/`end_call` (Phase 3), and
 * `travel_to_world` (Phase 4) under the same plugin.
 */
export class FederationPlugin implements WorldSimPlugin {
  readonly name = "federation";
  readonly version = "1.0.0";
  readonly parallel = true;

  private readonly _tools: AgentTool[];

  constructor(options: FederationPluginOptions) {
    this._tools = [
      createSendCrossWorldMessageTool({
        worldId: options.worldId,
        messageBus: options.messageBus,
      }),
    ];
  }

  get tools(): AgentTool[] {
    return this._tools;
  }
}
