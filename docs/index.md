---
layout: home

hero:
  name: WorldSim
  text: Multi-agent community simulation
  tagline: Simulate how communities react to new rules, events, or policies — in TypeScript, in 5 minutes.
  image:
    src: /worldsim_img.webp
    alt: WorldSim
  actions:
    - theme: brand
      text: Quick Start
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/francemazzi/worldsim

features:
  - title: LLM-agnostic
    details: OpenAI, Anthropic proxies, Ollama — anything OpenAI-compatible.
  - title: Personality system
    details: Mood, energy, goals, beliefs, and knowledge per agent.
  - title: Realistic perception
    details: Opt-in stimulus/perception/attention/topic/needs stack for physics-aware interactions.
  - title: Social dynamics
    details: Relationship tracking with strength decay and neighborhoods.
  - title: Rule enforcement
    details: Hard/soft rules with a governance agent for autonomous control.
  - title: Scalability
    details: 1000+ agents via concurrency caps, activity scheduling, and token budgets.
---

## What is WorldSim?

WorldSim is an embeddable multi-agent simulation engine for Node.js. You define a world, add agents with personalities and goals, optionally load rules or a crisis trigger, then let the engine advance tick by tick while agents reason, talk, use tools, build relationships and produce a report.

Use it when you want to test questions like:

- How does a village react to water rationing?
- How does a marketplace respond to a price shock?
- How does a rumor spread through social groups?
- What changes when agents only hear or see what is physically near them?

## How WorldSim Works

At runtime WorldSim is a loop around five ideas:

| Concept | What it means |
| --- | --- |
| **World** | The container for time, agents, rules, plugins, stores and reports. |
| **Ticks** | Discrete simulation steps. A tick can represent a minute, an hour, a day or any turn in your scenario. |
| **Agents** | LLM-driven actors with personality, mood, energy, memory, goals and optional tools. |
| **Rules** | JSON/PDF instructions evaluated by governance agents to warn, block or allow actions. |
| **Plugins** | Extension points for logging, reports, Studio, phones, movement, perception, custom tools and domain logic. |

The default interaction model is simple and backward-compatible: agent speech is routed through conversations, neighborhoods, proximity and finally broadcast. For more realistic worlds you can opt into the [perception layer](/perception), where speech and entity events become stimuli that agents must physically perceive before they can react.

| Mode | Use it when | Behavior |
| --- | --- | --- |
| `legacy` (default) | You want classic social simulations and maximum compatibility. | Messages flow through the legacy router and can fall back to broadcast. |
| `perception` | Location, senses, attention and causal threading matter. | Agents only react to perceived stimuli; strict mode can drop unheard speech. |

## What To Build First

| Goal | Start here |
| --- | --- |
| Watch a ready-made scenario | `npx worldsim demo` or `npx worldsim studio` |
| Build your own policy simulation | Copy `evaluation/scenarios/water-rationing/` |
| Test realistic location/senses behavior | Read [Perception Layer](/perception) and copy `evaluation/scenarios/village-realistic/` |
| Compare legacy vs perception | `npm run eval:compare-perception` |
| Integrate WorldSim in an app | Use `WorldEngine`, stores, plugins and the generated `SimulationReport` |

## Key Capabilities

| Feature | Description |
| ------- | ----------- |
| **LLM-agnostic** | OpenAI, Anthropic proxies, Ollama — anything OpenAI-compatible |
| **Personality system** | Mood, energy, goals, beliefs, knowledge per agent |
| **Realistic perception** | Opt-in stimulus/perception/attention/topic/needs stack for physics-aware agent interactions |
| **Social dynamics** | Relationship tracking with strength decay, neighborhoods |
| **Rule enforcement** | Hard/soft rules, governance agent with autonomous control |
| **Scalability** | 1000+ agents via concurrency caps, activity scheduling, token budgets |
| **Zero-config persistence** | In-memory by default; plug in Redis, Neo4j, PostgreSQL for production |
| **Real-time streaming** | Socket.IO events for live dashboards |
| **Simulation reports** | Auto-generated analysis with mood heatmaps and action metrics |
