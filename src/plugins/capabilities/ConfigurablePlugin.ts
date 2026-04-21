import type { WorldSimPlugin } from "../../types/PluginTypes.js";
import type { WorldConfig } from "../../types/WorldTypes.js";
import type { AgentRegistry } from "../../agents/AgentRegistry.js";
import type { AssetStore } from "../../types/AssetTypes.js";

/**
 * Context handed to plugins that implement {@link ConfigurablePlugin}.
 * Contains only the runtime handles plugins typically need after agents
 * have been instantiated but before the first tick fires.
 */
export interface PluginRuntimeContext {
  agentRegistry: AgentRegistry;
  assetStore?: AssetStore | undefined;
  config: Readonly<WorldConfig>;
}

/**
 * Capability interface for plugins that need post-bootstrap configuration
 * (access to agentRegistry, assetStore, or user-provided config knobs).
 * The engine calls `onRuntimeReady` once after agents are created.
 */
export interface ConfigurablePlugin {
  onRuntimeReady(ctx: PluginRuntimeContext): void | Promise<void>;
}

/**
 * Type guard that detects plugins exposing the ConfigurablePlugin capability.
 */
export function isConfigurablePlugin(
  p: WorldSimPlugin,
): p is WorldSimPlugin & ConfigurablePlugin {
  return (
    typeof (p as Partial<ConfigurablePlugin>).onRuntimeReady === "function"
  );
}
