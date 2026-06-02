# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- **Realistic simulation primitives** — opt-in perception layer that turns
  agent interactions into a physics-aware pipeline. Activated via the new
  `WorldConfig.interaction` block (`mode: "perception"`):
  - `Stimulus` + `StimulusBus` — every speak and every entity emitter
    (sound, sight, smell, touch, signal, event) becomes a tick-bounded fact
    on a dedicated bus with configurable retention.
  - `PerceptionEngine` — per-channel perception with linear distance
    attenuation, configurable `perceptionFloor`, language gating for
    intelligibility, optional line-of-sight filters.
  - `AttentionPolicy` — multi-factor salience scoring (intensity, novelty,
    needs/goals, relationships, interests, recency) with budget and
    threshold; below threshold the agent is allowed to stay silent.
  - `TopicTracker` — clusters causal chains and co-participation into
    topics so replies stay threaded across ticks.
  - `NeedsTracker` — drives (hunger, fatigue, fear, social…) with decay
    and regen per tick. Built-in `humanBasic` and `animalBasic` templates,
    plus arbitrary custom `NeedsState`. Auto-initialized by
    `WorldBootstrapper` from `AgentConfig.needs` or
    `interaction.defaultNeedsTemplate`.
  - `EntityRegistry` + `AffordanceResolver` — non-agent entities
    (animals, objects, signals) participate in the perception loop and
    expose affordances only when actually perceived. Add via
    `world.addEntity({ id, kind, position, emitters })`.
  - New `"perceive"` action type — passive acknowledgement that the agent
    noticed a stimulus without speaking. Tracked in the simulation report
    as a dedicated bucket in `ActionDistribution.perceive`.
  - Plugin hooks `onStimulusEmit`, `onPerceptDelivered`, `onNeedsTick`.
- New LLM prompt sections in perception mode: `--- PERCEZIONI ---` (ranked
  attended percepts, replacing the legacy "voice" bucket),
  `--- FILO DISCORSIVO ---` (dominant topic context),
  `--- BISOGNI ATTIVI ---` (active needs above their activation threshold).
- `TickContextLoader.isIdle` consults the perception layer: salient
  percepts and critical needs keep tired agents awake.
- New Studio dashboard page **Perception** with live stimuli, open topics,
  ranked percepts and needs bars per agent, refreshed on every tick.
- Read-only Studio API: `/api/perception/{status, stimuli, topics,
  percepts/:agentId, needs/:agentId}`.
- Three new evaluation scenarios using the perception layer:
  `village-realistic`, `enclosure-animals`, `office-floor`. The
  evaluation runner now wires perception scenarios end-to-end (entities,
  needs templates, satisfier plugin) and exposes them via the new
  `npm run eval:realistic` script.
- New `evaluation/compare-perception.ts` runner and
  `npm run eval:compare-perception` script: replays the same scenario in
  legacy and perception modes, then prints a delta table (replyRate,
  causalCoherence, silenceRatio, totalSpeaks, totalTokens).
- New `NeedsSatisfierPlugin` built-in plugin closing the
  decay <-> regen loop: default rules satisfy hunger/thirst/fatigue/social
  on matching agent actions (Italian + English keywords). Integrators can
  pass custom rules and disable defaults via `defaultRules: false`.
- Narrative analyzer is now perception-aware: every `NarrativeReport`
  carries an optional `PerceptionInsights` block (dominant topics,
  silence ratio, critical-need moments) computed by
  `computePerceptionInsights(report)`. The LLM prompt is enriched with
  the same context so the sociologist quote model favours topic-anchored
  exchanges first. `PerceptionMetrics` now also embeds a `topics: []`
  snapshot for downstream consumers.
- New runnable example `examples/realistic-village/` with
  `npm run demo:realistic`: 4 agents across 3 locations, 2 entities
  (bell + fountain), perception mode, default needs template, satisfier
  plugin, studio dashboard.
- Dedicated documentation page `docs/perception.md` covering status,
  mental model, configuration recipes, custom senses/filters, attention
  tuning, satisfier patterns, topics & threading, the studio panel and
  ready-made recipes (village/animal/office). Linked from the README.
- README section "Realistic simulation primitives" and updated skill at
  `.claude/skills/worldsim/SKILL.md`.
- Multi-world federation foundations (Phase 0 of the federation roadmap):
  type vocabulary in `src/federation/`, Zod schemas, `worldId:agentId`
  utilities, and a dedicated `worldsim/federation` sub-export.
- Architectural overview at `docs/federation.md` and ADR
  `docs/adr/001-federation-model.md` covering the asynchronous, namespaced,
  opt-in design.
- Asynchronous cross-world messaging (Phase 1):
  `FederationTransport` interface with `InMemoryFederationTransport` (tests/demos)
  and `RedisFederationTransport` (multi-process Pub/Sub) adapters.
  `FederationBus` orchestrator drains an inbound queue at the start of every
  tick and intercepts outbound messages with a `worldId:agentId` destination.
- New optional `federation` field on `WorldConfig` — wires the local world into
  a federation without changing single-world behaviour when absent.
- Built-in `FederationPlugin` exposing the `send_cross_world_message` agent
  tool (channels `sms` and `email`).
- New plugin hook `onCrossWorldMessage(envelope, direction)` fired on both
  inbound and outbound envelopes; `ConsoleLoggerPlugin` logs cross-world
  traffic in a distinguishable format.
- Demo `npm run demo:federation` (`examples/federation-two-cities/`) showing
  end-to-end async messaging between two worlds with no LLM/Redis required.

### Compatibility notes
- Legacy mode remains the default. Existing worlds that omit
  `WorldConfig.interaction` keep the legacy MessageRouter cascade.
- The perception layer is opt-in via `interaction.mode: "perception"`.
  When `requirePerception: true`, bootstrap now fails fast if person
  agents do not have usable senses or required locations.
- Public package imports are `worldsim` and `worldsim/federation`.
  Deep imports from `worldsim/dist/...` or `worldsim/src/...` are not
  supported as a compatibility contract.
- `resolveLlmEnv()` supports `OPENROUTER_API_KEY`; when both
  `OPENROUTER_API_KEY` and `OPENAI_API_KEY` are present, OpenRouter is
  selected unless an explicit LLM config is passed.

## [1.0.6] - 2026-04-03

### Added
- Studio dashboard with real-time agent visualization.
- CLI for managing simulations, agents, and reports.
- Report generation with Markdown and JSON output.
- Scenario loader for YAML-based evaluation definitions.
- Evaluation scenarios (village economy, social conflict, cooperation).
- Docker Compose support for Redis, Neo4j, and PostgreSQL.

## [1.0.0] - 2026-01-15

### Added
- WorldEngine core simulation loop.
- PersonAgent with LLM-driven personality, memory, and social dynamics.
- ControlAgent for orchestrating multi-agent conversations.
- Plugin system for extending engine behavior.
- Rules engine with declarative condition/action pairs.
- Memory store (in-memory and Redis-backed).
- Graph store (in-memory and Neo4j-backed).
- Real-time streaming via Socket.IO.
- Benchmark suite for latency and throughput measurement.
