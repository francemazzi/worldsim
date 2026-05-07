---
name: worldsim
description: Build, configure, scale and run worldsim multi-agent simulations in TypeScript. Use when the user asks to set up a WorldEngine, add agents, configure LLMs, control concurrency or rate limits, route messages privately (chat, SMS, calls), apply privacy/redaction rules, scale to thousands of agents, or build scenarios with rules, plugins and reports.
---

# worldsim

worldsim is an embeddable multi-agent simulation engine for Node.js / TypeScript. The core unit is a `WorldEngine` that runs a discrete-time tick loop. Agents reason via an OpenAI-compatible LLM, exchange messages on a `MessageBus`, and emit `AgentAction`s that plugins can transform, persist or report.

This skill teaches how to wire worldsim correctly for **production-style runs**: many agents, real LLM costs, rate limits, private chats, GDPR-compliant logging, custom rules and reports.

## When to use

Use this skill when the user wants to:

- spin up a `WorldEngine` with agents, rules and plugins
- pick the right LLM tiers and concurrency for cost/latency
- handle OpenAI rate limits (`429`) without crashing the run
- choose between broadcast, conversations, neighborhood, phones and SMS
- protect privacy of agent data (consent, redaction, retention)
- scale to thousands of agents without melting the LLM bill
- build a custom scenario or plugin

If the user only asks a narrow question (e.g. "where is `BatchExecutor`?"), answer directly without loading this skill.

## Mental model

A worldsim run is a deterministic tick loop. On each tick:

1. clock advances and `messageBus.newTick(tick)` is called
2. `onWorldTick` plugin hook fires
3. active agents are selected (paused/idle skipped, `defaultActiveTickRatio` downsamples)
4. selected agents reason in parallel through `BatchExecutor` (capped by `maxConcurrentAgents`)
5. each agent's `tick()` reads memory + messages, calls the LLM, emits actions and outgoing messages
6. `onAgentAction` plugins transform actions (privacy redaction lives here)
7. `ControlAgent`s evaluate actions as `allowed | warned | blocked`
8. action batch hooks fire, relationships decay in batch, control events apply

A "tick" is a logical unit (1 minute, 1 hour, 1 day, …) — _you_ decide. `tickIntervalMs` is wall-clock pacing only.

## Minimum viable world

```typescript
import { WorldEngine, InMemoryMemoryStore, InMemoryGraphStore } from "worldsim";

const world = new WorldEngine({
  worldId: "demo",
  maxTicks: 30,
  tickIntervalMs: 1000,
  llm: {
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY!,
    model: "gpt-4o-mini",
  },
  memoryStore: new InMemoryMemoryStore(),
  graphStore: new InMemoryGraphStore(),
});

world.addAgent({
  id: "alice",
  role: "person",
  name: "Alice",
  profile: { name: "Alice", personality: ["pragmatic"], goals: ["help neighbors"] },
});

await world.start();
```

## LLM configuration — picking tiers

`LLMConfig` supports retries (added in this branch) and three resolution levels:

| Level | Where | When to use |
| --- | --- | --- |
| `world.llm` | `WorldConfig.llm` | default for every agent |
| `world.lightLlm` | `WorldConfig.lightLlm` | cheap/fast tier for "background" agents (`llmTier: "light"`) |
| `agent.llm` | `AgentConfig.llm` (Partial) | per-agent override |

Always set retry options on the world LLM at minimum:

```typescript
llm: {
  baseURL: "https://api.openai.com/v1",
  apiKey: process.env.OPENAI_API_KEY!,
  model: "gpt-4o-mini",
  maxRetries: 3,
  retryInitialDelayMs: 500,
  retryMaxDelayMs: 8000,
  retryBackoffFactor: 2,
}
```

Mix tiers when an analyst/leader agent needs reasoning and citizens don't:

```typescript
const world = new WorldEngine({
  llm: { /* gpt-4o-mini, world default */ },
  lightLlm: { /* same baseURL+key, cheaper model+lower maxTokens */ },
});

world.addAgent({ id: "citizen-1", role: "person", name: "C1", llmTier: "light" });
world.addAgent({
  id: "mayor", role: "person", name: "Mayor",
  llm: { model: "gpt-4.1", maxTokens: 1500, temperature: 0.4 },
});
```

## Concurrency, rate limits and scale

Three knobs control how many LLM calls the world fires per second:

| Knob | Effect |
| --- | --- |
| `maxConcurrentAgents` | hard cap on parallel agent ticks via `BatchExecutor` |
| `defaultActiveTickRatio` | fraction of agents reasoning per tick (rest "rest"); agents with pending messages bypass it |
| `tickIntervalMs` | wall-clock pause between ticks |

Recommended starting points:

| Scale | `maxConcurrentAgents` | `defaultActiveTickRatio` | `tickIntervalMs` |
| --- | --- | --- | --- |
| Demo (≤ 10 agents) | 5 | 1.0 | 1000–2000 |
| Mid (50–200) | 10 | 0.2 | 500 |
| Large (1k) | 10 | 0.05 | 500 |
| Huge (10k) | 5–10 | 0.005–0.01 | 500–1000 |

The `OpenAICompatAdapter` retries `408 / 409 / 429 / 500 / 502 / 503 / 504` with exponential backoff + jitter and respects `Retry-After`. Combine with the knobs above instead of relying on retries alone.

Other cost-savers:

- `enableResponseCache: true` + `responseCacheTtl: 5` — cache identical chat completions for a few ticks
- `controlSamplingRate: 0.2` — only evaluate 20% of non-safe actions through `ControlAgent`s
- `tokenBudget` per agent — pause/degrade agents that exceed `perTick` / `perHour` / `lifetime` tokens

## Messaging & private routing

Default behaviour is a cascade in `MessageRouter`:

1. active conversation → only participants
2. neighborhood (graph store + `NeighborhoodManager`) → social peers
3. proximity (`LocationIndex` + `defaultBroadcastRadius`) → nearby agents
4. fallback → global broadcast (logs a warning)

To make agents talk privately:

- `world.createConversation(initiatorId, [participantIds], topic?)` — guaranteed 1:N routing through participants only
- `PhonePlugin` — agents with a phone asset get tools `send_sms`, `start_call`, `speak_in_call`, `hang_up`. The LLM decides when to use them; you must give them a `createPhoneAsset` and (optionally) contacts
- `MovementPlugin` + `defaultBroadcastRadius` — voices only reach physically close agents
- `neighborhood: { groups: [...], maxContacts: 20 }` on `AgentConfig` — group-scoped social graph

Avoid the broadcast fallback at scale: a single broadcast is "stimulus" for every agent and risks waking up the whole world.

## Privacy & compliance

Two layers:

1. **Routing privacy** — never let private content fall back to broadcast (see above)
2. **Data privacy** — register `WorldPrivacyConfig` and a `persistenceStore` that supports consent + audit (`PgPersistenceStore` does)

```typescript
const world = new WorldEngine({
  /* ... */
  persistenceStore,
  privacy: {
    regulatoryProfile: "gdpr",
    policyVersion: "v1",
    consentMode: "soft_gate",
    defaults: { required: true, redactionLevel: "partial", retentionDays: 30 },
    categories: {
      memory: { redactionLevel: "partial", retentionDays: 30 },
      social_graph: { redactionLevel: "strict", retentionDays: 14 },
      telemetry: { redactionLevel: "strict", retentionDays: 7 },
      tool_inputs: { required: true, allowToolUse: false },
    },
  },
});

await persistenceStore.upsertConsent?.({
  id: crypto.randomUUID(),
  worldId: "demo",
  subjectId: "alice",
  category: "memory",
  regulatoryProfile: "gdpr",
  policyVersion: "v1",
  status: "accepted",
  createdAt: new Date(),
  updatedAt: new Date(),
});
```

`privacyCompliancePlugin` redacts payloads, blocks tool calls when consent is missing (`soft_gate`), and writes per-action audits to `persistenceStore.savePolicyAudit`.

## Rules and ControlAgent

Rules live in JSON or PDF, loaded via `WorldConfig.rulesPath`. Each rule has `id`, `priority`, `scope` (`all | person | control`), `enforcement` (`hard | soft`) and free-form `instruction`. A `role: "control"` agent reads rules and judges actions as `allowed | warned | blocked`.

Use `controlSamplingRate < 1` at scale to avoid evaluating every action.

## Scenario layout

A scenario is a folder:

```
my-scenario/
├── scenario.json          # name, maxTicks, tickIntervalMs, trigger, agents[]
├── rules/
│   ├── base-rules.json    # active from tick 1
│   └── trigger-rules.json # added at trigger.atTick
├── expected.md            # qualitative rubric (optional)
└── index.ts               # runner: WorldEngine + plugins + addAgent loop
```

Copy `evaluation/scenarios/water-rationing/` and adapt. ~90% of simulation quality comes from the `systemPrompt` per agent — be specific about tone, values, internal conflicts.

## Plugins worth knowing

| Need | Plugin |
| --- | --- |
| Console logs for every event | `ConsoleLoggerPlugin` |
| Live dashboard | `studioPlugin({ engine, port: 4400 })` |
| SMS / calls | `PhonePlugin` (+ `InMemoryAssetStore`) |
| Movement with rules (walking radius, vehicles) | `MovementPlugin` + `LocationIndex` |
| Skills (farming, cooking…) | `LifeSkillsPlugin([...])` |
| Real-world tools (weather…) | `RealWorldToolsPlugin({ dataSources })` |
| Final report + sociology | `reportGeneratorPlugin({ engine })` |
| Privacy enforcement | auto-loaded when `WorldConfig.privacy` is set |

## Persistence

In-memory by default. For production:

- `Neo4jGraphStore` — relationship graph
- `PgVectorStore` + `OpenAIEmbeddingAdapter` — vector memory
- `PgPersistenceStore` — agent configs, conversations, consents, audits, snapshots
- `RedisMemoryStore` — fast memory store

Wire each on `WorldConfig` when needed.

## Federation (multi-world)

When `WorldConfig.federation` is set, the engine joins a federation through a transport (`InMemoryFederationTransport` or `RedisFederationTransport`). Agents can address `worldId:agentId` and the `MessageBus` routes externally without changing the local API.

## Reports

`reportGeneratorPlugin` produces a JSON `SimulationReport` with `summary`, `timeline`, per-agent trajectories, `relationships`, `metrics`, `network` (centrality, density, communities, homophily), `dialogue`, `shock` (when `recordPolicyTrigger` is called), `archetypes` (compliant / skeptic / resistant / apathetic), and an opt-in `narrative` via `POST /api/reports/:runId/narrative`.

Always call `report.recordPolicyTrigger(tick, announcement)` inside `world.on("tick", ...)` at the trigger tick if you want pre/post shock analysis.

## Common pitfalls

- **Homogeneous cast** → vary age, profession, personality, goals; check `network.homophily`
- **Ignored trigger** → announcement must be explicit + at least one `enforcement: "hard"` rule + a `role: "control"` agent
- **Broadcast fallback** → at scale, configure neighborhood / proximity / conversations to avoid waking 10k agents per speak
- **OpenAI 429** → set `maxConcurrentAgents` low and `maxRetries` ≥ 3 on `LLMConfig`
- **Language drift** → if the scenario is in Italian, repeat "parli sempre in italiano" in the system prompt
- **Below 15 ticks** → no narrative arc; minimum is 30 ticks with a mid-run trigger

## Realistic simulation primitives (perception layer)

Worldsim ships an opt-in stack of physics-aware primitives that make
agent interactions look like real life: agents only know what their
senses pick up, salience drives whether they react, and a topic tracker
keeps responses on the same thread. Activation is a single switch:

```typescript
const world = new WorldEngine({
  /* ...standard config... */
  interaction: {
    mode: "perception",
    defaultSenses: [
      { channel: "sound", radiusKm: 0.05 },
      { channel: "sight", radiusKm: 0.03 },
      { channel: "language" },
    ],
    disableBroadcastFallback: true,
    topicWindowTicks: 5,
  },
});
```

What you get when `mode: "perception"` is on:

- `Stimulus` + `StimulusBus` — every `speak`, every entity emitter
  (smell from a fountain, bark from a dog, signal from a radio) becomes
  a tick-bounded fact published on the bus.
- `PerceptionEngine` — per-channel perception with linear attenuation
  by distance, configurable `perceptionFloor`, language gating for
  intelligibility, optional `LineOfSightProvider` filters.
- `AttentionPolicy` — multi-factor salience scoring (intensity, novelty,
  needs/goals match, relationship strength, interests, recency) and
  budgeted attention. Below threshold = no LLM call, no forced reply.
- `TopicTracker` — clusters causal chains and co-participation into
  topics. The prompt scaffolding tells the agent which thread they are
  reacting to and asks them to declare topic switches.
- `NeedsTracker` — drives (hunger, fatigue, fear, social…) with
  decay/regen per tick. Built-in `humanBasic` and `animalBasic`
  templates; pass any custom `NeedsState` for your own ontology.
- `EntityRegistry` + `AffordanceResolver` — non-agent entities (animals,
  objects, signals) participate in the perception loop and expose
  affordances (`eat`, `sit`, `ride`, …) only when actually perceived.

Key design rules:

- The user picks the *what*: humans, animals, market, social feed —
  Worldsim doesn't lock you into one metaphor.
- The engine enforces the *how*: nothing reaches an agent that doesn't
  cross their senses; nothing forces an agent to reply if the salience
  is too low; topics keep replies coherent without scripting.
- Strict mode (`disableBroadcastFallback: true`) drops speech that no
  one perceives — like in real life.

How perception data flows into the LLM (when `mode: "perception"`):

- The agent's prompt gains a `--- PERCEZIONI ---` section listing the
  *attended* percepts in salience order, replacing the legacy "voice"
  bucket. Distance, intelligibility and topic id are surfaced inline.
- An optional `--- FILO DISCORSIVO ---` block appears when the agent
  is engaged in a dominant topic, so replies stay threaded.
- An optional `--- BISOGNI ATTIVI ---` block lists active needs above
  their `activationThreshold`. Critical needs also bypass the idle
  short-circuit so a thirsty agent doesn't fall asleep.
- The action union is widened with `"perceive"` so the LLM can stay
  silent when nothing deserves a reaction (no forced replies).
- `WorldBootstrapper` auto-initializes the `NeedsTracker` from
  `AgentConfig.needs` or, as a fallback, from
  `interaction.defaultNeedsTemplate` (`"humanBasic"` |
  `"animalBasic"`). Set the latter once at world level to give every
  agent a default drive set.

Studio dashboard exposes a dedicated **Perception** page (sidebar
entry) that reads `/api/perception/{status,stimuli,topics,percepts/:id,
needs/:id}` so you can debug what each agent actually heard, which
topics are open, and how their needs evolve tick by tick.

See `examples.md` and the realism integration test
`tests/integration/realism-fullstack.integration.test.ts` for full
runnable scenarios (village, animal enclosure).

## Files in this skill

- [examples.md](examples.md) — full runnable snippets for privacy, phones, federation, scaling
- [reference.md](reference.md) — `WorldConfig`, `AgentConfig`, `LLMConfig`, plugin hooks, message types

Read those only when the user asks for a specific implementation detail.
