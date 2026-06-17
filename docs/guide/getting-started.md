# Quick Start

## Run the demo

```bash
npm install worldsim
OPENAI_API_KEY=sk-... npx worldsim demo
# Open http://localhost:4400 — watch a village react to water rationing
```

Or with Docker:

```bash
OPENAI_API_KEY=sk-... docker compose up
# Open http://localhost:4400
```

## Minimal TypeScript world

```typescript
import {
  WorldEngine,
  ConsoleLoggerPlugin,
  InMemoryMemoryStore,
  InMemoryGraphStore,
  resolveLlmEnv,
} from "worldsim";

const llm = resolveLlmEnv();
if (!llm) throw new Error("Set OPENAI_API_KEY or OPENROUTER_API_KEY");

const world = new WorldEngine({
  worldId: "my-village",
  maxTicks: 20,
  llm,
  memoryStore: new InMemoryMemoryStore(),
  graphStore: new InMemoryGraphStore(),
});

world.use(ConsoleLoggerPlugin);

world.addAgent({
  id: "maria",
  role: "person",
  name: "Maria Rossi",
  iterationsPerTick: 2,
  profile: {
    name: "Maria Rossi",
    personality: ["practical", "stubborn"],
    goals: ["Save the harvest"],
  },
  systemPrompt: "You are Maria, a farmer worried about water rationing.",
});

await world.start();
```

That is the smallest useful loop: create a world, add at least one person agent, run ticks, inspect logs or attach report/Studio plugins.

## OpenRouter

WorldSim uses an OpenAI-compatible LLM adapter. To run via [OpenRouter](https://openrouter.ai/):

```bash
export OPENROUTER_API_KEY=sk-or-v1-...
export LLM_MODEL=mistralai/mistral-nemo
export OPENROUTER_APP_NAME=worldsim
export OPENROUTER_HTTP_REFERER=https://github.com/francemazzi/worldsim
npx worldsim demo
```

Or programmatically with `resolveLlmEnv()`:

```typescript
import { WorldEngine, resolveLlmEnv } from "worldsim";

const llm = resolveLlmEnv();
if (!llm) throw new Error("Set OPENAI_API_KEY or OPENROUTER_API_KEY");

const world = new WorldEngine({ worldId: "demo", llm, /* ... */ });
```

Supported env vars: `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_NAME`.

If both `OPENROUTER_API_KEY` and `OPENAI_API_KEY` are set, `resolveLlmEnv()` uses OpenRouter. Pass an explicit `llm` config to `WorldEngine` when you want to force another provider.

## What To Build First

| Goal | Start here |
| --- | --- |
| Watch a ready-made scenario | `npx worldsim demo` or `npx worldsim studio` |
| Build your own policy simulation | Copy `evaluation/scenarios/water-rationing/` |
| Test realistic location/senses behavior | Read [Perception Layer](/perception) and copy `evaluation/scenarios/village-realistic/` |
| Compare legacy vs perception | `npm run eval:compare-perception` |
| Integrate WorldSim in an app | Use `WorldEngine`, stores, plugins and the generated `SimulationReport` |
