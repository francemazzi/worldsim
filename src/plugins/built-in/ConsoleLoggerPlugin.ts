import type { WorldSimPlugin } from "../../types/PluginTypes.js";

export const ConsoleLoggerPlugin: WorldSimPlugin = {
  name: "console-logger",
  version: "1.0.0",

  async onWorldTick(tick, ctx) {
    console.log(`[WorldSim] Tick ${tick} — World: ${ctx.worldId}`);
  },

  async onAgentAction(action, state) {
    console.log(
      `[WorldSim] Agent ${action.agentId} [${state.status}]: ${action.actionType}`,
    );
    return action;
  },

  async onAgentStatusChange(event, oldStatus, newStatus) {
    const icons: Record<string, string> = {
      "agent:start": "▶",
      "agent:pause": "⏸",
      "agent:resume": "▶",
      "agent:stop": "⏹",
    };
    const icon = icons[event.type] ?? "?";
    console.log(
      `[WorldSim] ${icon} Agent ${event.agentId}: ${oldStatus} → ${newStatus}` +
        (event.reason ? ` (${event.reason})` : "") +
        ` [by: ${event.requestedBy}]`,
    );
  },

  async onWorldStop(ctx, events) {
    const byType = events.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {});
    console.log(`[WorldSim] World stopped after ${ctx.tickCount} ticks`);
    console.log(`[WorldSim] Events summary:`, byType);
  },
};
