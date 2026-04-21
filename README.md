<img src="https://raw.githubusercontent.com/francemazzi/worldsim/main/docs/worldsim_img.webp" alt="WorldSim" width="100%" style="border-radius: 16px; display: block; max-width: 100%;" />

# worldsim

[![GitHub stars](https://img.shields.io/github/stars/francemazzi/worldsim?style=social)](https://github.com/francemazzi/worldsim)

**Simulate how communities react to new rules, events, or policies — in TypeScript, in 5 minutes.**

WorldSim is an embeddable multi-agent simulation engine for Node.js. Define agents with distinct personalities, drop in a policy change, and watch coalitions form, conflicts emerge, and consensus build — all powered by LLM reasoning loops.

## Quick Start

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

## What You Can Simulate

**Community Policy Impact** — 8 villagers face a new water rationing policy. The farmer resists, the mayor defends, the priest mediates, the technologist proposes solutions. Who forms coalitions? Who complies?

**Market Price Shocks** — 10 marketplace agents react when grain prices double overnight. Sellers profit, buyers protest, regulators intervene. Economic reasoning emerges from personality-driven agents.

**Information Cascades** — 12 agents in 4 social groups. A rumor starts with one person. Watch it spread (or not) through the social graph, distorted by each personality along the way.

See [`evaluation/`](evaluation/) for repeatable scenarios with expected behaviors and quality criteria.

## Code Example

```typescript
import { WorldEngine, ConsoleLoggerPlugin, InMemoryMemoryStore, InMemoryGraphStore } from "worldsim";

const world = new WorldEngine({
  worldId: "my-village",
  maxTicks: 20,
  llm: {
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4o-mini",
  },
  memoryStore: new InMemoryMemoryStore(),
  graphStore: new InMemoryGraphStore(),
});

world.use(ConsoleLoggerPlugin);

world.addAgent({
  id: "maria", role: "person", name: "Maria Rossi",
  iterationsPerTick: 2,
  profile: { name: "Maria Rossi", personality: ["practical", "stubborn"], goals: ["Save the harvest"] },
  systemPrompt: "You are Maria, a farmer worried about water rationing.",
});

// Add more agents...

await world.start();
```

## Studio Dashboard

WorldSim includes a built-in web dashboard for real-time simulation monitoring:

```bash
npx worldsim studio
# Open http://localhost:4400
# Optional: --port 5000, --no-open
```

- **Live agent state** — mood, energy, goals, status
- **Event timeline** — every action, every tick
- **Relationship graph** — force-directed visualization of social connections
- **Simulation report** — mood heatmaps, energy charts, action distribution, timeline
- **Multi-world operations** — monitor and compare multiple world runs (city/country shards)

Main sections available in the dashboard:

- **Agents** — inspect profile, current status, goals, mood and energy in real time
- **Timeline** — follow what happens at each tick, with a chronological event stream
- **Relationship Graph** — visualize who influences whom and how social ties evolve
- **Report** — review post-run metrics, trends, and behavior distribution

```typescript
import { studioPlugin } from "worldsim";

engine.use(studioPlugin({ engine, port: 4400, memoryStore, graphStore }));
```

### UI Examples

Relationship Graph view (real-time social connection map):

![Relationship Graph](https://raw.githubusercontent.com/francemazzi/worldsim/main/docs/relationships.png)

Agent Details view (profile, internal state, and memory timeline):

![Agent Details](https://raw.githubusercontent.com/francemazzi/worldsim/main/docs/agent_details.png)

## Architecture

```mermaid
flowchart LR
  WorldEngine --> RulesLoader
  WorldEngine --> PluginRegistry
  WorldEngine --> PersonAgent
  WorldEngine --> ControlAgent
  PersonAgent --> LLM
  ControlAgent --> LLM
  PersonAgent -.-> MemoryStore
  PersonAgent -.-> GraphStore
```

- **WorldEngine** orchestrates ticks, agents, plugins, and lifecycle
- **PersonAgent** — LangGraph-powered agents with personality, mood, energy, goals, and tool use
- **ControlAgent** — governance agent that monitors rules and can pause/stop violators
- **Plugin system** — hooks on every world event + registerable tools for agents
- **Rules engine** — load from JSON or PDF, with priorities and enforcement levels

## How Simulation Time Works — Ticks

WorldSim is a **discrete-time simulation**: time does not flow continuously, it advances in integer steps called **ticks**. There is no internal notion of "seconds" or "minutes" — a tick is simply a logical unit of simulated time, and _you_ decide what it represents in your scenario (one minute, one hour, one day, one "turn"…).

### The tick loop

Once you call `world.start()`, the engine enters a loop that keeps running until `maxTicks` is reached or `stop()` is called. Every iteration:

1. Increments the world clock (`tick = tick + 1`).
2. Runs one full tick (see pipeline below).
3. Optionally sleeps for `tickIntervalMs` before starting the next one.

Two knobs in `WorldConfig` control the rhythm:

| Option | Meaning | Typical use |
| --- | --- | --- |
| `maxTicks` | How long the simulation runs (default `Infinity`) | `30` for the Villaggio del Sole demo |
| `tickIntervalMs` | Real-time pause between ticks (default `0`) | `2000` in the demo to let a human follow along in the dashboard; `0` in tests/benchmarks to run as fast as possible |

`tickIntervalMs` is **only** wall-clock pacing — it doesn't change what happens inside the simulation. Setting it to `0` just makes the same 30-tick scenario finish faster.

### What happens inside a single tick

Each tick executes a deterministic pipeline (see [`TickOrchestrator.executeTick`](src/engine/internal/TickOrchestrator.ts)):

1. **Clock increment** → `tick`, `context.tickCount`, `messageBus.newTick(tick)`.
2. **`onWorldTick` hook** fires on every registered plugin, then any handler attached via `world.on("tick", …)` runs.
3. **Per-tick resets** — token budget counters, stale conversations cleanup, neighborhood cache.
4. **Active agent selection** — which `PersonAgent`s will actually "think" this tick:
   - Paused/stopped agents are skipped.
   - Agents with pending messages always run (they have a stimulus to react to).
   - `defaultActiveTickRatio` and per-agent schedules (via `ActivityScheduler`) downsample the rest, so you don't pay an LLM call for every agent on every tick.
   - Remaining agents are sorted by number of pending messages (busiest first).
5. **Parallel agent reasoning** — selected agents run their `tick()` through `BatchExecutor`, which enforces `maxConcurrentAgents`. Each agent can internally loop up to `iterationsPerTick` times (recall memory → build context → call LLM → execute tools → emit messages/actions).
6. **Plugin action transforms** — collected `AgentAction`s flow through `onAgentAction` hooks, which can rewrite or annotate them.
7. **Relationship decay** is batched across all active agents.
8. **Control events applied** — pending lifecycle commands (`pause`, `resume`, `stop`) emitted during the tick take effect.
9. **ControlAgent evaluation** — governance agents rule each action as `allowed`, `warned`, or `blocked`.
10. **Action batch hooks + ControlAgent tick** — plugins see the final batch, governance agents run their own reasoning.

Everything temporal in the world is expressed in ticks: memory consolidation windows, relationship strength decay, conversation idle timeout, per-tick token budgets, scheduled control events, and so on.

### Concrete example — Villaggio del Sole

The `community-demo` scenario ([`examples/community-demo/`](examples/community-demo/)) runs 8 villagers + 1 governance agent for **30 ticks**, pacing at **2 seconds per tick**:

```json
{
  "name": "Villaggio del Sole — Razionamento Idrico",
  "maxTicks": 30,
  "tickIntervalMs": 2000,
  "trigger": { "atTick": 10, "announcement": "Il sindaco annuncia il razionamento…" }
}
```

With `iterationsPerTick: 2` on each villager, a single tick can contain up to two internal LLM reasoning steps per agent — enough to read incoming messages, check a tool (`check_weather`, `observe_environment`), decide how to react, and reply.

The scenario uses the tick counter as a **narrative timeline**:

- **Ticks 1–9** — baseline life in the village. Paolo (the journalist) checks the weather forecast, Maria (the farmer) observes her well drying up, gossip starts spreading through Giuseppe's bakery.
- **Tick 10** — the `on("tick", …)` handler fires the policy trigger:

  ```typescript
  world.on("tick", (tick) => {
    if (tick === triggerTick && announcement) {
      console.log(`POLICY TRIGGER — Tick ${tick}`);
    }
  });
  ```

  The water-rationing rules become active and the governance agent starts enforcing them.
- **Ticks 11–30** — coalitions form, resistance emerges, Sara proposes rainwater harvesting, Padre Lorenzo mediates. Every action, every message, every mood change is stamped with the tick it happened on, which is exactly what the Studio timeline and final report replay.

### Concrete example — lifecycle control

The `basic-world` example ([`examples/basic-world/index.ts`](examples/basic-world/index.ts)) shows ticks as **injection points** for host-driven events:

```typescript
world.on("tick", (tick) => {
  if (tick === 5)  world.pauseAgent("person-2", "Fase di test");
  if (tick === 8)  world.resumeAgent("person-2");
  if (tick === 15) world.stopAgent("person-4", "Missione completata");
});
```

Because the tick loop is the single clock of the simulation, scheduling "at tick N do X" is trivial — no cron, no timers, no race conditions. You can inject policy changes, simulated crises (a price shock, a rumor, a blackout) or agent lifecycle events deterministically at specific ticks, and the same scenario will replay identically if you fix the LLM seed.

### Pause, resume, stop

- `pause()` sets status to `paused` and the `while` loop exits cleanly; the clock freezes at the current tick.
- `resume()` re-enters `runLoop()` from the same tick — no state is lost.
- `stop()` ends the loop, fires the `onWorldStop` plugin hook with the full event log, and lets you collect the final report.

### Choosing `maxTicks` and `tickIntervalMs`

| Use case | `maxTicks` | `tickIntervalMs` | Notes |
| --- | --- | --- | --- |
| Live demo in the Studio dashboard | 20–50 | 1000–2000 | Human-watchable pace |
| Automated evaluation / CI | 20–100 | `0` | Run at full speed |
| Benchmarks | 100+ | `0` | Measure throughput |
| Long-horizon emergent dynamics | 200+ | `0` or small | Combine with `defaultActiveTickRatio` < 1 to keep LLM costs bounded |

If you're unsure, start with the community demo's numbers (`maxTicks: 30`, `tickIntervalMs: 2000`) and tune from there.

## Phones, Calls & Movement

Agents that own the right assets can text each other, place phone calls (their dialog is transcribed as a chat), and move around the world under rules you control.

```typescript
import {
  WorldEngine,
  InMemoryAssetStore,
  PhonePlugin,
  MovementPlugin,
  LocationIndex,
  createPhoneAsset,
  defaultMovementPolicy,
} from "worldsim";

const assetStore = new InMemoryAssetStore();
const locationIndex = new LocationIndex();

const engine = new WorldEngine({
  /* ...llm, stores... */
  assetStore,
  // Default policy allows walking within 1.5 km, requires a vehicle beyond.
  walkingRadiusMeters: 1500,
  // Or replace with your own rules (health data, public transit, licenses, …):
  // movementPolicy: (req) => ({ allowed: req.distanceMeters < 500, mode: "walking" }),
});

engine.use(new MovementPlugin(locationIndex));
engine.use(
  new PhonePlugin({
    assetStore,
    messageBus: engine.getMessageBus(),
    conversationManager: engine.getConversationManager(),
  }),
);

// Give Alice a phone and a car so she can text, call, and drive long distances.
await assetStore.addAssets([
  createPhoneAsset({ agentId: "alice", phoneNumber: "+39 111" }),
  { id: "car-alice", type: "vehicle", name: "Panda", owner: "alice", ownerType: "agent" },
]);
```

Once their phone is registered, agents automatically get four tools: `send_sms`, `start_call`, `speak_in_call`, `hang_up`. Call transcripts land on the bus as regular `Message`s with `type: "call_transcript"` and `metadata.callId`, so UIs and the reporting plugin can render them as chat turns.

Movement is governed by a `MovementPolicy` — a pure function that receives `{ agentId, from, to, distanceMeters, assets, profile }` and returns `{ allowed, mode?, reason? }`. Swap `defaultMovementPolicy` for anything you need: public transit, HealthKit steps, weather, curfews. WorldSim stays agnostic.

## Key Capabilities

| Feature | Description |
| ------- | ----------- |
| **LLM-agnostic** | OpenAI, Anthropic proxies, Ollama — anything OpenAI-compatible |
| **Personality system** | Mood, energy, goals, beliefs, knowledge per agent |
| **Social dynamics** | Relationship tracking with strength decay, neighborhoods |
| **Rule enforcement** | Hard/soft rules, governance agent with autonomous control |
| **Scalability** | 1000+ agents via concurrency caps, activity scheduling, token budgets |
| **Zero-config persistence** | In-memory by default; plug in Redis, Neo4j, PostgreSQL for production |
| **Real-time streaming** | Socket.IO events for live dashboards |
| **Simulation reports** | Auto-generated analysis with mood heatmaps and action metrics |

## Documentation

- [Architecture & internals](docs/architecture.md)
- [Persistence & databases](docs/persistence.md)
- [Scaling to production](docs/scaling.md)
- [Plugin authoring guide](docs/plugins.md)
- [Evaluation scenarios](evaluation/README.md)
- [Development roadmap](docs/ROADMAP.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, PR guidelines, and how to propose new scenarios.

## License

MIT
