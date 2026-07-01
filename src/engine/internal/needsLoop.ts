import type { AgentConfig } from "../../types/AgentTypes.js";
import type { InteractionConfig, WorldConfig } from "../../types/WorldTypes.js";
import type { NeedsTemplate } from "../../types/NeedsTypes.js";
import type { PluginRegistry } from "../../plugins/PluginRegistry.js";
import { NeedsSatisfierPlugin } from "../../plugins/built-in/NeedsSatisfierPlugin.js";

const NEEDS_SATISFIER_NAME = "needs-satisfier";

/** Returns true when at least one person agent will have tracked needs. */
export function worldHasNeedsAgents(
  interaction: InteractionConfig | undefined,
  pendingAgents: AgentConfig[],
): boolean {
  if (!interaction || interaction.mode !== "perception") return false;
  const template = interaction.defaultNeedsTemplate;
  const hasTemplate = template != null && template !== "none";
  for (const agent of pendingAgents) {
    if (agent.role !== "person") continue;
    if (agent.needs != null && agent.needs.needs.length > 0) return true;
    if (hasTemplate) return true;
  }
  return false;
}

export function hasNeedsSatisfierPlugin(registry: PluginRegistry): boolean {
  return registry.getAll().some((p) => p.name === NEEDS_SATISFIER_NAME);
}

/**
 * Registers {@link NeedsSatisfierPlugin} when perception mode is on, the
 * world has needs-bearing agents, and auto-registration is not disabled.
 */
export function autoRegisterNeedsSatisfierIfNeeded(
  config: WorldConfig,
  pendingAgents: AgentConfig[],
  registry: PluginRegistry,
): void {
  const interaction = config.interaction;
  if (!interaction || interaction.mode !== "perception") return;
  if (interaction.autoNeedsSatisfier === false) return;
  if (!worldHasNeedsAgents(interaction, pendingAgents)) return;
  if (hasNeedsSatisfierPlugin(registry)) return;
  registry.registerIfAbsent(new NeedsSatisfierPlugin());
}

/**
 * Validates the needs feedback loop configuration and emits warnings when
 * needs are enabled but no satisfier is registered.
 */
export function validateNeedsLoop(
  config: WorldConfig,
  pendingAgents: AgentConfig[],
  registry: PluginRegistry,
): void {
  const interaction = config.interaction;
  if (!worldHasNeedsAgents(interaction, pendingAgents)) return;

  const hasSatisfier = hasNeedsSatisfierPlugin(registry);
  if (interaction?.requireNeedsLoop && !hasSatisfier) {
    throw new Error(
      "WorldConfig.interaction.requireNeedsLoop is true but NeedsSatisfierPlugin " +
        "is not registered. Enable autoNeedsSatisfier or call engine.use(new NeedsSatisfierPlugin()).",
    );
  }
  if (!hasSatisfier && interaction?.autoNeedsSatisfier === false) {
    console.warn(
      "[WorldEngine] Perception mode with active needs but NeedsSatisfierPlugin is not " +
        "registered (autoNeedsSatisfier=false). Needs will decay without recovery.",
    );
  }
}

export function effectiveNeedsTemplate(
  interaction: InteractionConfig | undefined,
): NeedsTemplate | undefined {
  return interaction?.defaultNeedsTemplate;
}
