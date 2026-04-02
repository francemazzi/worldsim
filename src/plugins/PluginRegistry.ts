import type { WorldSimPlugin, AgentTool } from "../types/PluginTypes.js";
import type { AgentAction, AgentState } from "../types/AgentTypes.js";
import type { WorldContext } from "../types/WorldTypes.js";

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
          (hookFn as (...a: unknown[]) => Promise<unknown>).apply(plugin, args),
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
        await (hookFn as (...a: unknown[]) => Promise<unknown>).apply(
          plugin,
          args,
        );
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
        result = await (hookFn as (...a: unknown[]) => Promise<unknown>).apply(
          plugin,
          [result, ...args.slice(1)],
        );
      }
    }
    return result;
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
        batchParallel.push(plugin.onAgentActionsBatch!(actions, ctx));
      } else {
        batchSequential.push(plugin);
      }
    }
    if (batchParallel.length > 0) await Promise.all(batchParallel);
    for (const plugin of batchSequential) {
      await plugin.onAgentActionsBatch!(actions, ctx);
    }

    // Run per-action hooks for plugins without batch support
    if (perActionPlugins.length > 0) {
      for (const action of actions) {
        const state = buildState(action);
        for (const plugin of perActionPlugins) {
          await plugin.onAgentAction!(action, state);
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

  getPlugins(): readonly WorldSimPlugin[] {
    return this.plugins;
  }
}
