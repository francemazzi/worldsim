![WorldSim](docs/worldsim_img.png)

# @worldsim/core

Abstract virtual world emulator with LangGraph agents. A stateless, plugin-based multi-agent simulation engine for Node.js/TypeScript.

## Features

- **Multi-agent simulation** with LangGraph-powered reasoning loops
- **ControlAgent governance** that monitors rules and can pause/stop violating agents
- **PersonAgent agentic loops** with mid-loop lifecycle guards
- **Plugin system** with hooks for every lifecycle event
- **Rules engine** that loads JSON and PDF rule files at bootstrap
- **LLM-agnostic** via OpenAI-compatible adapter (works with OpenAI, Anthropic proxy, Ollama, etc.)
- **Fully stateless** — zero persistence, everything lives in RAM

## Quick Start

```typescript
import { WorldEngine, ConsoleLoggerPlugin } from "@worldsim/core";

const world = new WorldEngine({
  worldId: "my-world",
  maxTicks: 20,
  tickIntervalMs: 500,
  llm: {
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4o-mini",
  },
  rulesPath: {
    json: ["./rules/*.json"],
  },
});

world.use(ConsoleLoggerPlugin);

world.addAgent({
  id: "governance",
  role: "control",
  name: "Governance Agent",
  systemPrompt: "Monitor rules and enforce compliance.",
});

world.addAgent({
  id: "alice",
  role: "person",
  name: "Alice",
  iterationsPerTick: 3,
  systemPrompt: "You are a curious person who asks questions.",
});

world.addAgent({
  id: "bob",
  role: "person",
  name: "Bob",
  iterationsPerTick: 2,
  systemPrompt: "You are an enthusiastic person who proposes ideas.",
});

await world.start();
```

## Agent Lifecycle

Agents follow a state machine: `idle → running → paused → running` (resume) or `→ stopped` (terminal).

```
idle ──start──▶ running ──pause──▶ paused
                  │                   │
                  │──stop──▶ stopped ◀──stop──│
                                      │
                            (terminal, no transitions)
```

The host application can control agents via `world.pauseAgent()`, `world.resumeAgent()`, `world.stopAgent()`. ControlAgents can also autonomously manage PersonAgent lifecycles via the built-in `control_agent` tool.

## Plugins

```typescript
world.use({
  name: "my-plugin",
  version: "1.0.0",
  async onWorldTick(tick, ctx) { /* ... */ },
  async onAgentAction(action, state) { return action; },
  async onAgentStatusChange(event, oldStatus, newStatus) { /* ... */ },
  async onWorldStop(ctx, events) { /* ... */ },
  tools: [{ name: "my_tool", description: "...", inputSchema: {}, execute: async (input, ctx) => { /* ... */ } }],
});
```

## Rules

Rules are loaded at bootstrap from JSON files and/or PDF files (extracted via LLM).

```json
{
  "version": "1.0.0",
  "name": "My Rules",
  "rules": [
    {
      "id": "rule-001",
      "priority": 1,
      "scope": "all",
      "instruction": "Agents must communicate respectfully.",
      "enforcement": "hard"
    }
  ]
}
```

## Scripts

| Command | Description |
|---|---|
| `npm run build` | Build with tsup (CJS + ESM) |
| `npm test` | Run unit tests |
| `npm run test:integration` | Run integration tests (requires `.env`) |
| `npm run test:prompts` | Run promptfoo evaluations (requires `.env`) |
| `npm run test:all` | Run all tests |
| `npm run typecheck` | TypeScript type checking |

## License

MIT
