# Plugin Authoring Guide

Plugins are the primary extension mechanism in `worldsim`. They can observe and transform agent actions, inject tools that agents can call, react to lifecycle events, and integrate with external systems.

---

## WorldSimPlugin interface

A plugin is any object that satisfies the `WorldSimPlugin` interface (defined in [`../src/types/PluginTypes.ts`](../src/types/PluginTypes.ts)):

```ts
interface WorldSimPlugin {
  name: string;
  version: string;
  parallel?: boolean;

  onBootstrap?(ctx: WorldContext, rules: RulesContext): Promise<void>;
  onWorldTick?(tick: number, ctx: WorldContext): Promise<void>;
  onAgentAction?(action: AgentAction, state: AgentState): Promise<AgentAction>;
  onAgentActionsBatch?(actions: AgentAction[], ctx: WorldContext): Promise<void>;
  onRulesLoaded?(rules: RulesContext): Promise<void>;
  onWorldStop?(ctx: WorldContext, events: WorldEvent[]): Promise<void>;
  onAgentStatusChange?(
    event: AgentControlEvent,
    oldStatus: AgentStatus,
    newStatus: AgentStatus,
  ): Promise<void>;

  tools?: AgentTool[];
}
```

All hooks are optional. Implement only the ones you need.

### Hook reference

| Hook | Called when | Can transform? |
|------|-----------|----------------|
| `onBootstrap` | After rules are loaded and before agents start. Use for initialization. | No |
| `onWorldTick` | At the start of every tick, before agents execute. | No |
| `onAgentAction` | Once per action, per plugin. Return the (optionally modified) action. | Yes |
| `onAgentActionsBatch` | Once per tick with all actions. Mutually exclusive with `onAgentAction` for the same plugin. | No |
| `onRulesLoaded` | After all rule files are parsed. Use to inspect or augment rules. | No |
| `onWorldStop` | When the engine stops. Receives the full event log. | No |
| `onAgentStatusChange` | On any agent lifecycle transition (start, pause, resume, stop). | No |

### Registering a plugin

```ts
engine.use(myPlugin);
```

Plugin names must be unique. Attempting to register a duplicate name throws an error.

---

## The parallel flag

By default, plugin hooks run sequentially in registration order. Set `parallel: true` to allow a plugin's hooks to run concurrently with other parallel plugins.

```ts
const myPlugin: WorldSimPlugin = {
  name: "async-logger",
  version: "1.0.0",
  parallel: true, // Hooks run concurrently with other parallel plugins
  async onWorldTick(tick) {
    await sendToExternalService(tick);
  },
};
```

Execution order:
1. All `parallel: true` plugins for a given hook run concurrently via `Promise.all`.
2. All sequential plugins (default) run in registration order, after parallel ones complete.

Errors in any plugin hook are caught and logged as warnings; they never crash the engine.

Source: [`../src/plugins/PluginRegistry.ts`](../src/plugins/PluginRegistry.ts)

---

## Batch hooks vs per-action hooks

For plugins that process actions, you have two choices:

### `onAgentAction` (per-action)

Called once per action. Receives the action and the agent's current state. Must return the action (optionally transformed). Use this when you need to modify or filter individual actions.

```ts
async onAgentAction(action, state) {
  if (action.actionType === "speak") {
    // Censor profanity
    action.payload.content = censor(action.payload.content);
  }
  return action;
}
```

### `onAgentActionsBatch` (batch)

Called once per tick with all actions from that tick. More efficient for plugins that process multiple actions at once (logging, analytics, bulk writes). When a plugin implements `onAgentActionsBatch`, its `onAgentAction` is **not** called.

```ts
async onAgentActionsBatch(actions, ctx) {
  await db.insertMany(actions.map(a => ({
    tick: a.tick,
    agent: a.agentId,
    type: a.actionType,
  })));
}
```

---

## Registering tools for agents

Plugins can expose tools that agents can invoke during their agentic loop. Add them to the `tools` array on the plugin.

### AgentTool interface

```ts
interface AgentTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
  execute(input: unknown, ctx: WorldContext): Promise<unknown>;
}
```

- `name` — unique tool name (across all plugins).
- `description` — shown to the LLM so agents understand when to use the tool.
- `inputSchema` — JSON Schema object describing the expected input shape.
- `execute` — runs when an agent calls the tool. Receives the parsed input and the current `WorldContext`.

### How agents get tools

By default, every person agent receives all tools from all registered plugins. To restrict which tools an agent can access, set `toolNames` in the agent config:

```ts
engine.addAgent({
  id: "farmer",
  role: "person",
  toolNames: ["plant_seed", "harvest_crop", "walk_to"],
  // ...
});
```

Control agents do not receive plugin tools. They have their own built-in `control_agent` tool for governance.

---

## Built-in plugins

### ConsoleLoggerPlugin

A simple logger that prints tick progress, agent actions, status changes, and a summary on stop.

```ts
import { ConsoleLoggerPlugin } from "worldsim";

engine.use(ConsoleLoggerPlugin);
```

Source: [`../src/plugins/built-in/ConsoleLoggerPlugin.ts`](../src/plugins/built-in/ConsoleLoggerPlugin.ts)

### LifeSkillsPlugin

Provides a comprehensive set of simulation tools across multiple skill categories: movement (`walk_to`, `run_to`), social (`greet`, `chat_with`), physical, farming, technology, spiritual, academic, cooking, and crafting. Each tool returns narrative-flavored results with randomized outcomes.

```ts
import { LifeSkillsPlugin } from "worldsim";

engine.use(LifeSkillsPlugin);
```

The skill categories and their tools are defined using a resolver pattern. See [`../src/plugins/built-in/LifeSkillsPlugin.ts`](../src/plugins/built-in/LifeSkillsPlugin.ts) for the full list.

### ReportGeneratorPlugin

Collects simulation data during the run and produces a `SimulationReport` when the world stops. Tracks action distributions, mood/energy trajectories, status changes, and a timeline of key events.

```ts
import { reportGeneratorPlugin } from "worldsim";

const report = reportGeneratorPlugin({ engine });
engine.use(report.plugin);

await engine.start();
const data = report.getReport(); // SimulationReport | null
```

This is a factory function (not a plain object) because it needs a reference to the engine. The plugin is marked `parallel: true` so it does not slow down the tick loop.

Source: [`../src/plugins/built-in/ReportGeneratorPlugin.ts`](../src/plugins/built-in/ReportGeneratorPlugin.ts)

---

## Example: creating a custom plugin

Here is a complete example of a plugin that logs actions to a database and provides a custom tool:

```ts
import type { WorldSimPlugin } from "worldsim";

export function createWeatherPlugin(db: Database): WorldSimPlugin {
  return {
    name: "weather",
    version: "1.0.0",
    parallel: true,

    // Initialize weather data on bootstrap
    async onBootstrap(ctx, rules) {
      await db.query("CREATE TABLE IF NOT EXISTS weather (...)");
    },

    // Update weather each tick
    async onWorldTick(tick, ctx) {
      const weather = generateWeather(tick);
      ctx.metadata.currentWeather = weather;
    },

    // Log all actions in bulk
    async onAgentActionsBatch(actions, ctx) {
      await db.insertMany(
        "action_log",
        actions.map((a) => ({
          tick: a.tick,
          agentId: a.agentId,
          type: a.actionType,
          weather: ctx.metadata.currentWeather,
        })),
      );
    },

    // React to agent lifecycle changes
    async onAgentStatusChange(event, oldStatus, newStatus) {
      console.log(`Agent ${event.agentId}: ${oldStatus} -> ${newStatus}`);
    },

    // Provide a tool that agents can call
    tools: [
      {
        name: "check_weather",
        description: "Check the current weather conditions in the world.",
        inputSchema: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description: "The location to check weather for",
            },
          },
          required: ["location"],
        },
        async execute(input, ctx) {
          const { location } = input as { location: string };
          return {
            location,
            conditions: ctx.metadata.currentWeather ?? "sunny",
            temperature: 20 + Math.random() * 15,
          };
        },
      },
    ],
  };
}
```

Usage:

```ts
engine.use(createWeatherPlugin(myDb));
```

---

## Plugin design tips

- **Use `parallel: true`** for plugins that do I/O (database writes, HTTP calls, logging) and do not need to transform actions. This prevents slow plugins from blocking the tick loop.
- **Prefer `onAgentActionsBatch`** over `onAgentAction` when you only need to observe actions without transforming them. A single batch call is more efficient than N individual calls.
- **Keep `onWorldTick` lightweight** — it runs on every tick. Defer heavy work to background tasks or batch it in `onWorldStop`.
- **Tool names must be globally unique** across all plugins. If two plugins register a tool with the same name, the second one shadows the first.
- **Plugin hooks never crash the engine** — exceptions are caught and logged as warnings. Design your plugins to handle their own errors gracefully.
