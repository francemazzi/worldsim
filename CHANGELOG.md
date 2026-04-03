# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

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
