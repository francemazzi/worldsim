# Scaling to Production

This document covers the knobs and strategies available in `worldsim` to scale simulations from a handful of agents to thousands, while keeping LLM costs and latency under control.

---

## Concurrency control

By default, all active agents execute in parallel each tick. Use `maxConcurrentAgents` to cap how many run simultaneously via the `BatchExecutor` semaphore pattern.

```ts
const engine = new WorldEngine({
  llm: { ... },
  maxConcurrentAgents: 20, // At most 20 agent LLM calls in flight
});
```

`BatchExecutor` (in [`../src/engine/BatchExecutor.ts`](../src/engine/BatchExecutor.ts)) uses `executeSettled()` so that a single agent failure never crashes the tick. Failed agents are logged and skipped.

---

## Activity scheduling

Not every agent needs to run every tick. The `ActivityScheduler` (in [`../src/scheduling/ActivityScheduler.ts`](../src/scheduling/ActivityScheduler.ts)) supports several gating mechanisms:

### World-level active ratio

Set `defaultActiveTickRatio` to randomly skip agents each tick. A value of `0.1` means roughly 10% of agents are active per tick (ideal for 10k+ agents). Agents with pending messages always bypass this gate.

```ts
const engine = new WorldEngine({
  llm: { ... },
  defaultActiveTickRatio: 0.1, // 10% of agents active per tick
});
```

### Per-agent schedules

Each agent can have a fine-grained `schedule` in its config:

```ts
engine.addAgent({
  id: "shopkeeper",
  role: "person",
  schedule: {
    activeTickRatio: 0.5,       // Active 50% of ticks
    sleepCycle: {
      activeFrom: 6,            // Start of active period within cycle
      activeTo: 22,             // End of active period
      period: 24,               // Cycle length in ticks
    },
    cooldownTicks: 3,           // Minimum ticks between activations
    actionsPerHour: 10,         // Max actions per simulated hour
  },
  // ...
});
```

The scheduler uses deterministic hashing so the same agent on the same tick always gets the same activation decision, making simulations reproducible.

---

## Token budget tracking

`TokenBudgetTracker` (in [`../src/scheduling/TokenBudgetTracker.ts`](../src/scheduling/TokenBudgetTracker.ts)) monitors LLM token consumption per agent at three granularities: per-tick, per-hour, and lifetime. When a budget is exceeded, a configurable policy fires.

```ts
engine.addAgent({
  id: "expensive-agent",
  role: "person",
  tokenBudget: {
    perTick: 4_000,        // Max tokens per tick
    perHour: 50_000,       // Max tokens per simulated hour
    lifetime: 1_000_000,   // Max tokens over agent lifetime
    policy: "pause",       // "pause" | "degrade" | "stop"
  },
  // ...
});
```

Policies:
- **`pause`** — pauses the agent; it can be resumed later.
- **`stop`** — permanently stops the agent.
- **`degrade`** — keeps the agent running but reduces `maxTokens` in LLM calls.

Token tracking is done transparently by `TrackingLLMAdapter`, which wraps each agent's LLM adapter.

---

## Neighborhood optimization

`NeighborhoodManager` (in [`../src/graph/NeighborhoodManager.ts`](../src/graph/NeighborhoodManager.ts)) limits how many relationships each agent maintains, reducing the social graph size and LLM context bloat.

```ts
engine.addAgent({
  id: "villager",
  role: "person",
  neighborhood: {
    maxContacts: 20,     // Hard cap on active relationships
    groups: ["village"],  // Group-scoped queries
  },
  // ...
});
```

Key features:
- **Relationship decay** — strength decreases by `decayRate` (default 0.01) per tick of no interaction.
- **Pruning** — relationships below `minStrength` (default 0.05) are removed.
- **Batch processing** — decay and pruning run in a single pass for all active agents each tick.
- **Per-tick cache** — neighbor lookups are cached and reset each tick to avoid redundant graph queries.

---

## Response caching

Enable LLM response caching to avoid redundant calls when agents receive similar prompts:

```ts
const engine = new WorldEngine({
  llm: { ... },
  enableResponseCache: true,
  responseCacheTtl: 5, // Responses expire after 5 ticks
});
```

The `ResponseCache` (in [`../src/llm/ResponseCache.ts`](../src/llm/ResponseCache.ts)) is an LRU cache keyed by message content hash. It only caches `chat()` calls, never `chatWithTools()` calls (which have side effects). The cache holds up to 500 entries and lazily evicts expired entries when the tick advances.

---

## Light LLM tier

Route less critical agents to a cheaper/faster model:

```ts
const engine = new WorldEngine({
  llm: { baseURL: "...", apiKey: "...", model: "gpt-4o" },
  lightLlm: { baseURL: "...", apiKey: "...", model: "gpt-4o-mini" },
});

engine.addAgent({
  id: "background-npc",
  role: "person",
  llmTier: "light", // Uses lightLlm config instead of main llm
  // ...
});
```

Agents without `llmTier` (or with `llmTier: "default"`) use the main `llm` config. If `lightLlm` is not set, light-tier agents fall back to the main model.

Source: [`../src/llm/LLMAdapterPool.ts`](../src/llm/LLMAdapterPool.ts)

---

## Control sampling

At scale, having a `ControlAgent` evaluate every action is expensive. Use `controlSamplingRate` to reduce governance LLM calls:

```ts
const engine = new WorldEngine({
  llm: { ... },
  controlSamplingRate: 0.2, // Evaluate 20% of actions, auto-approve the rest
});
```

Set to `0.1`-`0.3` at scale to reduce ControlAgent LLM calls by 70-90%. Only non-safe actions are subject to sampling; the exact selection is randomized per tick.

---

## Proximity-based messaging

In large worlds, broadcasting messages to all agents is wasteful. Use `defaultBroadcastRadius` to scope messages by spatial proximity:

```ts
const engine = new WorldEngine({
  llm: { ... },
  defaultBroadcastRadius: 1.0, // 1km radius
});
```

Agents with a `location` in their profile will only receive messages from nearby agents. Agents without a location or with radius `0` fall back to global broadcast (backward-compatible).

---

## Queue/workers for async operations

For heavy async work (embedding generation, persistence writes, memory consolidation), consider:

- Running `engine.consolidate()` on a cron schedule rather than every tick.
- Using `BrainMemory.saveBatch()` instead of individual saves (the engine does this by default).
- Placing embedding calls behind a worker queue if your `EmbeddingAdapter` has rate limits.

Memory consolidation is opt-in and triggered explicitly:

```ts
// Run after the simulation or on a timer
const results = await engine.consolidate();
// Returns ConsolidationResult[] with stats per agent
```

---

## Observability

### Event log

The engine maintains a circular buffer event log (default 10,000 entries, configurable via `eventLogMaxSize`). Access it with:

```ts
const events = engine.getEventLog();
```

Events include: `agent:error`, `agent:paused`, `agent:resumed`, `agent:stopped`, `action:blocked`, `action:warned`, `action:executed`.

### Plugin hooks for metrics

Use plugin hooks to export metrics to your observability stack:

```ts
engine.use({
  name: "metrics",
  version: "1.0.0",
  parallel: true,
  async onWorldTick(tick, ctx) {
    metrics.gauge("worldsim.tick", tick);
  },
  async onAgentActionsBatch(actions, ctx) {
    metrics.increment("worldsim.actions", actions.length);
  },
});
```

### ReportGeneratorPlugin

The built-in `ReportGeneratorPlugin` collects comprehensive simulation data (action distributions, mood/energy trajectories, timeline, relationship evolution) and produces a `SimulationReport` when the world stops.

Source: [`../src/plugins/built-in/ReportGeneratorPlugin.ts`](../src/plugins/built-in/ReportGeneratorPlugin.ts)

---

## Guardrails

### Timeouts

- `maxTicks` — hard cap on simulation length. The tick loop exits when reached.
- `tickIntervalMs` — minimum delay between ticks (useful for real-time simulations).
- `ConversationManager` stale threshold — auto-ends conversations that idle for too many ticks.

### Kill switches

- `engine.stop()` — gracefully stops the engine after the current tick.
- `engine.stopAgent(id, reason)` — immediately stops a specific agent.
- Token budget `"stop"` policy — auto-kills agents that exceed their lifetime token budget.
- `ControlAgent` — can autonomously stop agents via its `control_agent` tool.

### Event log size

The event log uses a `CircularBuffer` (default 10,000 entries). Oldest events are discarded when full, preventing unbounded memory growth.

```ts
const engine = new WorldEngine({
  llm: { ... },
  eventLogMaxSize: 50_000, // Increase if you need more history
});
```
