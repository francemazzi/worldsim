<img src="https://raw.githubusercontent.com/francemazzi/worldsim/main/docs/worldsim_img.webp" alt="WorldSim" width="100%" style="border-radius: 16px; display: block; max-width: 100%;" />

# worldsim

[![GitHub stars](https://img.shields.io/github/stars/francemazzi/worldsim?style=social)](https://github.com/francemazzi/worldsim)
[![Documentation](https://img.shields.io/badge/docs-francemazzi.github.io%2Fworldsim-blue)](https://francemazzi.github.io/worldsim/)

**Simulate how communities react to new rules, events, or policies — in TypeScript, in 5 minutes.**

WorldSim is an embeddable multi-agent simulation engine for Node.js. You define a world, add agents with personalities and goals, optionally load rules or a crisis trigger, then let the engine advance tick by tick while agents reason, talk, use tools, build relationships and produce a report.

## Documentation

**Full documentation:** [https://francemazzi.github.io/worldsim/](https://francemazzi.github.io/worldsim/)

| Topic | Link |
| --- | --- |
| Quick Start | [Getting Started](https://francemazzi.github.io/worldsim/guide/getting-started) |
| Architecture | [Architecture & Internals](https://francemazzi.github.io/worldsim/architecture) |
| Perception layer | [Realistic Simulation Primitives](https://francemazzi.github.io/worldsim/perception) |
| Creating scenarios | [Creating Scenarios](https://francemazzi.github.io/worldsim/guide/creating-scenarios) |
| Scaling & production | [Scaling](https://francemazzi.github.io/worldsim/scaling) |
| Plugin authoring | [Plugins](https://francemazzi.github.io/worldsim/plugins) |

## Quick Start

```bash
npm install worldsim
OPENAI_API_KEY=sk-... npx worldsim demo
# Open http://localhost:4400 — watch a village react to water rationing
```

Or launch the Studio dashboard directly:

```bash
npx worldsim studio
```

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

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, PR guidelines, and how to propose new scenarios.

## License

MIT
