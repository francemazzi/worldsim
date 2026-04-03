# WorldSim Evaluation Suite

This directory contains **3 repeatable evaluation scenarios** designed to measure the quality of multi-agent simulations produced by WorldSim.

## Methodology

Each scenario follows a consistent structure:

1. **Input Configuration** (`scenario.json`) -- A declarative scenario file with agents, rules, triggers, and timing parameters. These are fed directly into `WorldEngine`.

2. **Expected Behaviors** (`expected.md`) -- A per-agent breakdown of what _should_ happen when the simulation runs correctly. This serves as a qualitative rubric for human review and as a reference for automated checks.

3. **Quality Criteria** (`../criteria.md`) -- A shared rubric applied across all scenarios covering personality consistency, rule awareness, social coherence, coalition formation, and narrative emergence.

4. **Failure Modes** -- Each `expected.md` also lists specific failure modes: patterns that indicate the simulation is broken or degenerate.

## Scenarios

| Scenario | Agents | Ticks | Trigger | Theme |
|---|---|---|---|---|
| `water-rationing` | 8 | 30 | Tick 10: water rationing policy | Community under resource pressure |
| `price-shock` | 10 | 25 | Tick 8: grain price doubles | Marketplace economic disruption |
| `rumor-spread` | 12 | 30 | Tick 5: false rumor introduced | Information propagation through social groups |

## Running

```bash
# Run all scenarios
npx tsx evaluation/run-evaluation.ts

# Run a single scenario
npx tsx evaluation/run-evaluation.ts water-rationing
```

Results are written to `evaluation/results/{scenario-name}.json` as full `SimulationReport` objects.

## Evaluation Workflow

1. Run the evaluation script to produce report JSONs.
2. Review each report against the expected behaviors in the corresponding `expected.md`.
3. Score each scenario using the rubric in `criteria.md`.
4. Look for the failure modes listed in each `expected.md` -- their presence indicates a regression.
