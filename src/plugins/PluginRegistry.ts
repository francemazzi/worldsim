import type { WorldSimPlugin, AgentTool } from "../types/PluginTypes.js";

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
    for (const plugin of this.plugins) {
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
