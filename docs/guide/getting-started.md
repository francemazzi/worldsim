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

## Emergence-style cross-vendor integration test

A scaled-down reproduction of the [Emergence World](https://arxiv.org/abs/2606.08367) cross-LLM study runs three parallel micro-worlds (homogeneous model A, homogeneous model B, mixed population) via OpenRouter.

Copy [`.env.example`](https://github.com/francemazzi/worldsim/blob/main/.env.example) to `.env`, set `OPENROUTER_API_KEY`, then:

```bash
npm run test:integration:emergence
```

Optional env vars:

| Variable | Default | Purpose |
| --- | --- | --- |
| `EMERGENCE_MODEL_A` | `google/gemini-2.5-flash` | Model for homogeneous A / half of mixed |
| `EMERGENCE_MODEL_B` | `anthropic/claude-3-haiku` | Model for homogeneous B / other half of mixed |
| `EMERGENCE_MAX_TICKS` | `8` | Simulation length |
| `EMERGENCE_MAX_CONCURRENT` | `2` | Parallel agent cap (rate-limit friendly) |

Without `OPENROUTER_API_KEY` the test suite is skipped automatically.

To regenerate the README example chart (writes `docs/public/emergence-m2-example.json`, `.svg`, and `.png`):

```bash
npm run emergence:chart          # live OpenRouter run
npm run emergence:chart:render   # render SVG from committed JSON only
```

## What To Build First

| Goal | Start here |
| --- | --- |
| Watch a ready-made scenario | `npx worldsim demo` or `npx worldsim studio` |
| Build your own policy simulation | Copy `evaluation/scenarios/water-rationing/` |
| Test realistic location/senses behavior | Read [Perception Layer](/perception) and copy `evaluation/scenarios/village-realistic/` |
| Compare legacy vs perception | `npm run eval:compare-perception` |
| Integrate WorldSim in an app | Use `WorldEngine`, stores, plugins and the generated `SimulationReport` |
