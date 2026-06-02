# WorldSim Evaluation Suite

This directory contains **3 repeatable evaluation scenarios** designed to measure the quality of multi-agent simulations produced by WorldSim.

## Methodology

Each scenario follows a consistent structure:

1. **Input Configuration** (`scenario.json`) -- A declarative scenario file with agents, rules, triggers, and timing parameters. These are fed directly into `WorldEngine`.

2. **Expected Behaviors** (`expected.md`) -- A per-agent breakdown of what _should_ happen when the simulation runs correctly. This serves as a qualitative rubric for human review and as a reference for automated checks.

3. **Quality Criteria** (`../criteria.md`) -- A shared rubric applied across all scenarios covering personality consistency, rule awareness, social coherence, coalition formation, and narrative emergence.

4. **Failure Modes** -- Each `expected.md` also lists specific failure modes: patterns that indicate the simulation is broken or degenerate.

## Scenarios

### Policy / market scenarios (legacy routing)

| Scenario | Agents | Ticks | Trigger | Theme |
|---|---|---|---|---|
| `water-rationing` | 8 | 30 | Tick 10: water rationing policy | Community under resource pressure |
| `price-shock` | 10 | 25 | Tick 8: grain price doubles | Marketplace economic disruption |
| `rumor-spread` | 12 | 30 | Tick 5: false rumor introduced | Information propagation through social groups |

### Realistic-perception scenarios (perception layer on)

| Scenario | Agents | Ticks | Theme |
|---|---|---|---|
| `village-realistic` | 4 | 25 | Piazza/bar/casa: only co-located agents hear each other |
| `enclosure-animals` | 4 | 20 | Wolves and prey communicating via sound + smell |
| `office-floor` | 6 | 30 | Open space + meeting rooms reproduced through geography only |

These scenarios opt in to the [perception layer](../docs/perception.md):
each `speak` becomes a stimulus filtered by senses and distance. They
also auto-attach the `NeedsSatisfierPlugin` so decay is balanced by
in-scenario actions.

## Running

```bash
# Run all scenarios
npm run eval

# Run a single (legacy) scenario
npx tsx evaluation/run-evaluation.ts water-rationing

# Run a single realistic scenario
npm run eval:realistic
# or
npx tsx evaluation/run-evaluation.ts village-realistic

# Side-by-side legacy vs perception comparison (runs the LLM TWICE)
npm run eval:compare-perception
# or
npx tsx evaluation/compare-perception.ts office-floor
```

Results are written to `evaluation/results/{scenario-name}.json` as full
`SimulationReport` objects. The comparison runner additionally produces
`{scenario-name}-legacy.json` and `{scenario-name}-perception.json`.

## Perception comparison

`compare-perception.ts` runs the same scenario twice — once forced into
legacy mode, once with the perception layer on — and prints a delta
table covering:

- `Total speaks` (raw verbal output)
- `Total tokens` (LLM cost)
- `Reply rate` (in-thread responses)
- `Causal coherence` (fraction of speeches that follow a previous one)
- `Silence ratio` (`perceive` vs `speak` actions)
- `Avg participants/topic`

What to expect when the perception layer is doing its job:

- **`Total speaks` drops** — agents don't reply when nothing reaches
  their senses; silence becomes a valid outcome.
- **`Causal coherence` rises** — speeches that *do* happen are
  threaded inside topics, so the conversation no longer drifts.
- **`Silence ratio` rises** — passive `perceive` actions replace forced
  monologues at zero token cost.
- **`Reply rate` may drop** if the scenario placed agents far apart on
  purpose. Read the diff together with the per-agent breakdown.

## Evaluation Workflow

1. Run the evaluation script to produce report JSONs.
2. Review each report against the expected behaviors in the corresponding `expected.md`.
3. Score each scenario using the rubric in `criteria.md`.
4. Look for the failure modes listed in each `expected.md` -- their presence indicates a regression.
