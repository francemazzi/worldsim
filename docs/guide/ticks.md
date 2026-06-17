# Simulation Time (Ticks)

WorldSim is a **discrete-time simulation**: time does not flow continuously, it advances in integer steps called **ticks**. There is no internal notion of "seconds" or "minutes" — a tick is simply a logical unit of simulated time, and _you_ decide what it represents in your scenario (one minute, one hour, one day, one "turn"…).

## The tick loop

Once you call `world.start()`, the engine enters a loop that keeps running until `maxTicks` is reached or `stop()` is called. Every iteration:

1. Increments the world clock (`tick = tick + 1`).
2. Runs one full tick (see pipeline below).
3. Optionally sleeps for `tickIntervalMs` before starting the next one.

Two knobs in `WorldConfig` control the rhythm:

| Option | Meaning | Typical use |
| --- | --- | --- |
| `maxTicks` | How long the simulation runs (default `Infinity`) | `30` for the Sun Village demo |
| `tickIntervalMs` | Real-time pause between ticks (default `0`) | `2000` in the demo to let a human follow along in the dashboard; `0` in tests/benchmarks to run as fast as possible |

`tickIntervalMs` is **only** wall-clock pacing — it doesn't change what happens inside the simulation. Setting it to `0` just makes the same 30-tick scenario finish faster.

## What happens inside a single tick

Each tick executes a deterministic pipeline (see `TickOrchestrator.executeTick` in the source):

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

See [Architecture](/architecture) for a deeper dive into `TickOrchestrator` and agent internals.

## Concrete example — Sun Village

The `community-demo` scenario runs 8 villagers + 1 governance agent for **30 ticks**, pacing at **2 seconds per tick**:

```json
{
  "name": "Sun Village — Water Rationing",
  "maxTicks": 30,
  "tickIntervalMs": 2000,
  "trigger": { "atTick": 10, "announcement": "The mayor announces water rationing…" }
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

## Concrete example — lifecycle control

The `basic-world` example shows ticks as **injection points** for host-driven events:

```typescript
world.on("tick", (tick) => {
  if (tick === 5)  world.pauseAgent("person-2", "Fase di test");
  if (tick === 8)  world.resumeAgent("person-2");
  if (tick === 15) world.stopAgent("person-4", "Missione completata");
});
```

Because the tick loop is the single clock of the simulation, scheduling "at tick N do X" is trivial — no cron, no timers, no race conditions. You can inject policy changes, simulated crises (a price shock, a rumor, a blackout) or agent lifecycle events deterministically at specific ticks. The host-driven timeline stays stable; the exact LLM text can still vary by model, provider and temperature.

## Pause, resume, stop

- `pause()` sets status to `paused` and the `while` loop exits cleanly; the clock freezes at the current tick.
- `resume()` re-enters `runLoop()` from the same tick — no state is lost.
- `stop()` ends the loop, fires the `onWorldStop` plugin hook with the full event log, and lets you collect the final report.

## Choosing `maxTicks` and `tickIntervalMs`

| Use case | `maxTicks` | `tickIntervalMs` | Notes |
| --- | --- | --- | --- |
| Live demo in the Studio dashboard | 20–50 | 1000–2000 | Human-watchable pace |
| Automated evaluation / CI | 20–100 | `0` | Run at full speed |
| Benchmarks | 100+ | `0` | Measure throughput |
| Long-horizon emergent dynamics | 200+ | `0` or small | Combine with `defaultActiveTickRatio` < 1 to keep LLM costs bounded |

If you're unsure, start with the community demo's numbers (`maxTicks: 30`, `tickIntervalMs: 2000`) and tune from there.
