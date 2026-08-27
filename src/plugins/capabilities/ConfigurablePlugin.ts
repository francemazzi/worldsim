import type { WorldSimPlugin } from "../../types/PluginTypes.js";
import type { WorldConfig } from "../../types/WorldTypes.js";
import type { AgentRegistry } from "../../agents/AgentRegistry.js";
import type { AssetStore } from "../../types/AssetTypes.js";
import type { NeedsTracker } from "../../needs/NeedsTracker.js";
import type { TopicTracker } from "../../perception/TopicTracker.js";
import type { StimulusBus } from "../../perception/StimulusBus.js";
import type { LocationIndex } from "../../location/LocationIndex.js";
import type { ActivityScheduler } from "../../scheduling/ActivityScheduler.js";

/**
 * Context handed to plugins that implement {@link ConfigurablePlugin}.
 * Contains only the runtime handles plugins typically need after agents
 * have been instantiated but before the first tick fires.
 */
export interface PluginRuntimeContext {
  agentRegistry: AgentRegistry;
  locationIndex?: LocationIndex | undefined;
  assetStore?: AssetStore | undefined;
  config: Readonly<WorldConfig>;
  /**
   * Realistic-simulation handles. Always provided; when the perception
   * layer is off the trackers are empty (no agents registered, no
   * stimuli published) but the references are still safe to use.
   */
  needsTracker?: NeedsTracker | undefined;
  topicTracker?: TopicTracker | undefined;
  stimulusBus?: StimulusBus | undefined;
  activityScheduler?: ActivityScheduler | undefined;
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
