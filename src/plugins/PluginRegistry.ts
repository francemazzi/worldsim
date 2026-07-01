import type { WorldSimPlugin, AgentTool } from "../types/PluginTypes.js";
import type { AgentAction, AgentState } from "../types/AgentTypes.js";
import type { WorldContext } from "../types/WorldTypes.js";
import type { Percept } from "../types/PerceptionTypes.js";
import type { NeedsState } from "../types/NeedsTypes.js";
import type { Stimulus } from "../types/StimulusTypes.js";

type HookName = keyof {
  [K in keyof WorldSimPlugin as WorldSimPlugin[K] extends
    | ((...args: never[]) => Promise<unknown>)
    | undefined
    ? K
    : never]: true;
};

export class PluginRegistry {
  private plugins: WorldSimPlugin[] = [];

  register(plugin: WorldSimPlugin): void {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new Error(
        `[PluginRegistry] Plugin "${plugin.name}" is already registered`,
      );
    }
    this.plugins.push(plugin);
  }

  /** Returns a snapshot of all registered plugins. */
  getAll(): readonly WorldSimPlugin[] {
    return [...this.plugins];
  }

  async runHook<K extends HookName>(
    hookName: K,
    ...args: Parameters<NonNullable<WorldSimPlugin[K]>>
  ): Promise<void> {
    // Separate parallel and sequential plugins
    const parallelTasks: Promise<unknown>[] = [];
    const sequentialPlugins: WorldSimPlugin[] = [];

    for (const plugin of this.plugins) {
      const hookFn = plugin[hookName];
      if (typeof hookFn !== "function") continue;

      if (plugin.parallel) {
        parallelTasks.push(
          (hookFn as (...a: unknown[]) => Promise<unknown>).apply(plugin, args)
            .catch((err: unknown) => {
              console.warn(`[PluginRegistry] Plugin "${plugin.name}" threw in ${hookName}:`, err);
            }),
        );
      } else {
        sequentialPlugins.push(plugin);
      }
    }

    // Run parallel hooks concurrently
    if (parallelTasks.length > 0) {
      await Promise.all(parallelTasks);
    }

    // Run sequential hooks in order
    for (const plugin of sequentialPlugins) {
      const hookFn = plugin[hookName];
      if (typeof hookFn === "function") {
        try {
          await (hookFn as (...a: unknown[]) => Promise<unknown>).apply(
            plugin,
            args,
          );
        } catch (err) {
          console.warn(`[PluginRegistry] Plugin "${plugin.name}" threw in ${hookName}:`, err);
        }
      }
    }
  }

  async runHookWithTransform<K extends HookName>(
    hookName: K,
    ...args: Parameters<NonNullable<WorldSimPlugin[K]>>
  ): Promise<unknown> {
    let result: unknown = args[0];
    for (const plugin of this.plugins) {
      const hookFn = plugin[hookName];
      if (typeof hookFn === "function") {
        try {
          result = await (hookFn as (...a: unknown[]) => Promise<unknown>).apply(
            plugin,
            [result, ...args.slice(1)],
          );
        } catch (err) {
          console.warn(`[PluginRegistry] Plugin "${plugin.name}" threw in ${hookName}:`, err);
        }
      }
    }
    return result;
  }

  /**
   * Runs stimulus transform hooks in registration order. These hooks are
   * intentionally sequential because each plugin receives the previous
   * plugin's transformed stimulus; returning null cancels emission.
   */
  async runStimulusEmitHooks(
    stimulus: Stimulus,
    ctx: WorldContext,
  ): Promise<Stimulus | null> {
    let current: Stimulus | null = stimulus;
    for (const plugin of this.plugins) {
      if (!current) return null;
      if (typeof plugin.onStimulusEmit !== "function") continue;
      try {
        current = await plugin.onStimulusEmit(current, ctx);
      } catch (err) {
        console.warn(`[PluginRegistry] Plugin "${plugin.name}" threw in onStimulusEmit:`, err);
      }
    }
    return current;
  }

  /**
   * Runs percept transform hooks in registration order. Returning an empty
   * array is the supported way for a plugin to filter all percepts.
   */
  async runPerceptDeliveredHooks(
    agentId: string,
    percepts: Percept[],
    ctx: WorldContext,
  ): Promise<Percept[]> {
    let current = percepts;
    for (const plugin of this.plugins) {
      if (typeof plugin.onPerceptDelivered !== "function") continue;
      try {
        current = await plugin.onPerceptDelivered(agentId, current, ctx);
      } catch (err) {
        console.warn(`[PluginRegistry] Plugin "${plugin.name}" threw in onPerceptDelivered:`, err);
      }
    }
    return current;
  }

  /**
   * Runs needs transform hooks in registration order after the tracker has
   * applied its own tick update. Plugins may return a replacement state.
   */
  async runNeedsTickHooks(
    agentId: string,
    needs: NeedsState,
    ctx: WorldContext,
  ): Promise<NeedsState> {
    let current = needs;
    for (const plugin of this.plugins) {
      if (typeof plugin.onNeedsTick !== "function") continue;
      try {
        current = await plugin.onNeedsTick(agentId, current, ctx);
      } catch (err) {
        console.warn(`[PluginRegistry] Plugin "${plugin.name}" threw in onNeedsTick:`, err);
      }
    }
    return current;
  }

  /**
   * Runs action hooks efficiently:
   * - Plugins with onAgentActionsBatch get called once with all actions
   * - Plugins with only onAgentAction get called per-action (sequential)
   */
  async runActionHooks(
    actions: AgentAction[],
    ctx: WorldContext,
    buildState: (action: AgentAction) => AgentState,
    opts?: { skipPerAction?: boolean },
  ): Promise<void> {
    if (actions.length === 0) return;

    const batchPlugins: WorldSimPlugin[] = [];
    const perActionPlugins: WorldSimPlugin[] = [];

    for (const plugin of this.plugins) {
      if (typeof plugin.onAgentActionsBatch === "function") {
        batchPlugins.push(plugin);
      } else if (typeof plugin.onAgentAction === "function") {
        perActionPlugins.push(plugin);
      }
    }

    // Run batch hooks (can be parallelized if marked parallel)
    const batchParallel: Promise<void>[] = [];
    const batchSequential: WorldSimPlugin[] = [];
    for (const plugin of batchPlugins) {
      if (plugin.parallel) {
        batchParallel.push(
          plugin.onAgentActionsBatch!(actions, ctx).catch((err: unknown) => {
            console.warn(`[PluginRegistry] Plugin "${plugin.name}" threw in onAgentActionsBatch:`, err);
          }),
        );
      } else {
        batchSequential.push(plugin);
      }
    }
    if (batchParallel.length > 0) await Promise.all(batchParallel);
    for (const plugin of batchSequential) {
      try {
        await plugin.onAgentActionsBatch!(actions, ctx);
      } catch (err) {
        console.warn(`[PluginRegistry] Plugin "${plugin.name}" threw in onAgentActionsBatch:`, err);
      }
    }

    // Run per-action hooks for plugins without batch support
    if (!opts?.skipPerAction && perActionPlugins.length > 0) {
      for (const action of actions) {
        const state = buildState(action);
        for (const plugin of perActionPlugins) {
          try {
            await plugin.onAgentAction!(action, state);
          } catch (err) {
            console.warn(`[PluginRegistry] Plugin "${plugin.name}" threw in onAgentAction:`, err);
          }
        }
      }
    }
  }

  getAllTools(): AgentTool[] {
    return this.plugins.flatMap((p) => p.tools ?? []);
  }

  getToolsByNames(names: string[]): AgentTool[] {
    const all = this.getAllTools();
    return all.filter((t) => names.includes(t.name));
  }

  getPlugin(name: string): WorldSimPlugin | undefined {
    return this.plugins.find((p) => p.name === name);
  }

  getPlugins(): readonly WorldSimPlugin[] {
    return this.plugins;
  }

  /**
   * Returns the first plugin that satisfies the given capability predicate,
   * or undefined if none does. This lets the engine talk to plugins through
   * structural capability interfaces instead of concrete classes or plugin
   * name strings.
   */
  getCapability<T>(
    predicate: (p: WorldSimPlugin) => p is WorldSimPlugin & T,
  ): (WorldSimPlugin & T) | undefined {
    return this.plugins.find(predicate);
  }

  /**
   * Returns every plugin that satisfies the given capability predicate.
   */
  getCapabilities<T>(
    predicate: (p: WorldSimPlugin) => p is WorldSimPlugin & T,
  ): (WorldSimPlugin & T)[] {
    return this.plugins.filter(predicate);
  }
}
