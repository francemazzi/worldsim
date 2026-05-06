import type { AgentStatus, AgentControlEvent } from "../../types/AgentTypes.js";
import type { TimelineMetadata } from "../../types/TimelineTypes.js";
import type { WorldEngineRuntime } from "./WorldEngineRuntime.js";

export class ControlEventApplier {
  constructor(
    private runtime: WorldEngineRuntime,
    private logEvent: (type: string, agentId: string, payload: unknown, metadata?: TimelineMetadata) => void,
  ) {}

  apply(tick: number): void {
    const messages = this.runtime.messageBus.getMessages("world-engine", tick);

    for (const msg of messages) {
      if (msg.type !== "system") continue;

      let event: AgentControlEvent;
      try {
        event = JSON.parse(msg.content) as AgentControlEvent;
        if (msg.metadata) event.metadata = msg.metadata;
      } catch {
        continue;
      }

      if (!event.type?.startsWith("agent:")) continue;

      const target = this.runtime.agentRegistry.get(event.agentId);
      if (!target) continue;

      const oldStatus = target.status;

      switch (event.type) {
        case "agent:pause":
          target.pause(tick, event.requestedBy);
          break;
        case "agent:resume":
          target.resume(tick, event.requestedBy);
          break;
        case "agent:stop":
          target.stop(tick, event.requestedBy);
          this.runtime.agentRegistry.remove(event.agentId);
          this.runtime.personAgents = this.runtime.personAgents.filter(
            (p) => p.id !== event.agentId,
          );
          break;
      }

      const newStatus = event.type === "agent:stop" ? "stopped" : target.status;

      this.logEvent(event.type.replace("agent:", "agent:"), event.agentId, {
        requestedBy: event.requestedBy,
        reason: event.reason,
      }, event.metadata);

      this.runtime.pluginRegistry.runHook(
        "onAgentStatusChange",
        event,
        oldStatus,
        newStatus as AgentStatus,
      );
    }
  }
}
