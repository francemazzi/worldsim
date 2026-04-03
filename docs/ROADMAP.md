# WorldSim Roadmap

## Phase 1 -- Core Foundation (Done)

- WorldEngine simulation loop
- PersonAgent with LLM-backed personality and memory
- ControlAgent for multi-agent orchestration
- Plugin system
- Rules engine
- Persistence: Redis memory store, Neo4j graph store, PostgreSQL via Drizzle

## Phase 2 -- Observability and Tooling (Done)

- Real-time streaming via Socket.IO
- Studio dashboard for live agent visualization
- CLI for simulation management
- Benchmark suite for latency and throughput

## Phase 3 -- Evaluation and Community (Current)

- YAML-based evaluation scenarios
- Automated report generation (Markdown and JSON)
- Scenario loader and runner
- Community templates, contributing guide, issue templates

## Phase 4 -- Replay and Comparison (Next)

- Deterministic replay of past simulation runs
- Side-by-side run comparison with diff views
- Advanced visualizations (relationship graphs, mood timelines)

## Phase 5 -- Platform (Future)

- Hosted demo sandbox for trying WorldSim without local setup
- SDK for building custom UIs on top of WorldSim
- Multi-world federation: connect independent simulations
