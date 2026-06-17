# Creating Your Own Scenario

A WorldSim scenario is just a folder with four ingredients. The simplest way to start is to copy [`evaluation/scenarios/water-rationing/`](https://github.com/francemazzi/worldsim/tree/main/evaluation/scenarios/water-rationing) and adapt it.

```
my-scenario/
├── scenario.json          # agents + trigger + timing
├── rules/
│   ├── base-rules.json    # rules active from tick 1
│   └── trigger-rules.json # rules loaded when the shock fires
├── expected.md            # (optional) qualitative rubric for evaluation
└── index.ts               # runner that wires engine + plugins
```

## 1. `scenario.json` — the "script"

A declarative file with timing, the policy trigger, and the cast:

| Field | Purpose |
| --- | --- |
| `name`, `description` | Human-readable identity of the run |
| `maxTicks` | How long the simulation runs (e.g. `30`) |
| `tickIntervalMs` | Wall-clock pause between ticks (`2000` for live demo, `0` for tests) |
| `trigger.atTick` | When the disruptive event fires |
| `trigger.addRules` | Relative paths of rule files to load at the trigger |
| `trigger.announcement` | Broadcast text delivered to every agent |
| `agents[]` | The list of actors |

Each agent declares its identity and — crucially — its personality:

```jsonc
{
  "id": "maria",
  "role": "person",            // "person" | "control" (governance)
  "name": "Maria Rossi",
  "iterationsPerTick": 2,      // internal LLM reasoning steps per tick
  "systemPrompt": "You are Maria, a 52-year-old farmer, practical and stubborn…",
  "profile": {
    "age": 52,
    "profession": "Farmer",
    "personality": ["practical", "stubborn", "generous"],
    "goals": ["Save the harvest", "Protect the family"],
    "backstory": "…",
    "skills": ["farming", "cooking"]
  }
}
```

The `systemPrompt` is where simulation quality lives: the more specific it is about tone, values and internal conflicts, the longer the agent stays in character across the run.

## 2. `rules/*.json` — the normative fabric

Rules are interpreted by the `RuleEngine` and enforced by the governance `ControlAgent`:

```json
{
  "version": "1.0",
  "name": "Village rules",
  "rules": [
    {
      "id": "rispetto",
      "priority": 1,
      "scope": "all",
      "instruction": "All members must communicate respectfully. Insults are forbidden.",
      "enforcement": "hard"
    }
  ]
}
```

- `scope` — `"all"` (everyone), `"person"` (only human agents), `"control"` (only governance agents).
- `enforcement` — `"hard"` blocks the action, `"soft"` only warns.
- `priority` — lower number = evaluated first.
- `instruction` — free text passed to the ControlAgent as judgement context.

The convention across the existing scenarios is two files: a **base** rulebook loaded from tick 1 (e.g. `community-rules.json`) and a **trigger** rulebook loaded at `trigger.atTick` via `trigger.addRules` (e.g. `water-rationing.json`).

## 3. `expected.md` — the qualitative rubric (optional)

Not required to run the simulation, but essential when you want to *judge* its output. It lists, per agent, what the run should look like, the expected dynamics over time, and the failure modes that signal a broken scenario. Together with [`evaluation/criteria.md`](https://github.com/francemazzi/worldsim/blob/main/evaluation/criteria.md) it forms the rubric used to score simulation reports.

## 4. `index.ts` — the runner

The runner wires the scenario into a `WorldEngine`, registers plugins and fires the trigger. A minimal template:

```typescript
import {
  WorldEngine,
  ConsoleLoggerPlugin,
  InMemoryMemoryStore,
  InMemoryGraphStore,
  studioPlugin,
  reportGeneratorPlugin,
  resolveLlmEnv,
} from "worldsim";
import { readFileSync } from "node:fs";

const scenario = JSON.parse(readFileSync("scenario.json", "utf-8"));
const llm = resolveLlmEnv();
if (!llm) throw new Error("Set OPENAI_API_KEY or OPENROUTER_API_KEY");

const world = new WorldEngine({
  worldId: scenario.name,
  maxTicks: scenario.maxTicks,
  tickIntervalMs: scenario.tickIntervalMs,
  llm,
  rulesPath: { json: ["rules/community-rules.json"] },
  memoryStore: new InMemoryMemoryStore(),
  graphStore: new InMemoryGraphStore(),
});

world.use(ConsoleLoggerPlugin);

const report = reportGeneratorPlugin({ engine: world });
world.use(report.plugin);
world.use(studioPlugin({ engine: world, port: 4400, open: true }));

for (const agent of scenario.agents) world.addAgent(agent);

world.on("tick", (tick) => {
  if (tick === scenario.trigger.atTick) {
    report.recordPolicyTrigger(tick, scenario.trigger.announcement);
  }
});

await world.start();
```

Calling `report.recordPolicyTrigger(tick, announcement)` at the trigger tick is what lets the report build the `shock` section (pre/post stats, deltas, `recoveryTicks`).

## Optional building blocks

Add these only when the scenario needs them:

| If you want... | Add |
| --- | --- |
| Phones / SMS / calls between agents | `PhonePlugin` + `InMemoryAssetStore` + `createPhoneAsset` |
| Physical movement across the world | `MovementPlugin` + `LocationIndex` + `MovementPolicy` |
| Realistic perception (senses, attention, topics, needs) | `interaction: { mode: "perception", defaultSenses: [...] }` on `WorldConfig` (see [Perception Layer](/perception)) |
| Non-agent entities (animals, objects, signals) | `world.addEntity({ id, kind, position, emitters })` (requires `interaction.mode === "perception"`) |
| Vital skills (farming, cooking…) | `LifeSkillsPlugin([...])` |
| Real-world tools (weather, environment) | `RealWorldToolsPlugin({ dataSources })` |
| Live dashboard in the browser | `studioPlugin({ engine, port: 4400 })` |
| Final report + sociological analysis | `reportGeneratorPlugin({ engine })` |
| Shock analysis in the report | `report.recordPolicyTrigger(tick, msg)` |
| Reproducible evaluation | Drop the scenario under `evaluation/scenarios/<name>/` and run `run-evaluation.ts` |

## What you get at the end

`reportGeneratorPlugin` produces a `SimulationReport` — fully JSON-serializable, consumable from the Studio dashboard and exportable to CSV — with:

- `summary`, `timeline`, per-agent trajectories (`mood`, `energy`, status changes).
- `relationships[]` with initial/final strength and per-tick snapshots.
- `metrics` (speaks, observations, tool calls, tokens, cost).
- `network` — degree / betweenness / eigenvector centrality, density over time, communities, reciprocity, homophily.
- `dialogue` — who-talks-to-whom matrix, voice Gini, response rate, message-length stats.
- `shock` (when `recordPolicyTrigger` is called) — pre/post windows, deltas, `recoveryTicks`.
- `archetypes` — each agent classified as `compliant | skeptic | resistant | apathetic` with rationale, plus emotional contagion and mood variance per tick.
- `narrative` (opt-in, LLM cost) — global story arc, per-agent arcs, emblematic quotes. Triggered via `POST /api/reports/:runId/narrative`.

## Recommended workflow

1. **Copy a template** — duplicate `evaluation/scenarios/water-rationing/` as `evaluation/scenarios/my-case/`.
2. **Rewrite `scenario.json`** with at least 3 personalities in *tension* (otherwise "immediate consensus" kills the narrative).
3. **Define the rules**: a few soft rules as baseline + one hard rule as the trigger shock.
4. **Write `expected.md`** — even just for yourself, it makes it obvious when a run is broken.
5. **Run it live** with `tickIntervalMs: 2000` and the Studio dashboard to watch dynamics unfold.
6. **Run it headless** (`tickIntervalMs: 0`) and compare `evaluation/results/<name>.json` against `expected.md` using [`criteria.md`](https://github.com/francemazzi/worldsim/blob/main/evaluation/criteria.md).
7. **Iterate on the system prompts** — ~90% of simulation quality comes from prompt specificity and the clarity of the trigger announcement.

## Common pitfalls to avoid

- **Homogeneous cast** → vary age, profession, personality, goals. The `network.homophily` score in the report will flag this.
- **Ignored trigger** → the announcement must be explicit and at least one rule needs `enforcement: "hard"` with a governance agent (`role: "control"`) to enforce it.
- **Monologues** → give agents backstories that *connect* them, and prompt them to address others by name.
- **Language drift** → if the scenario uses a specific language, insist in the prompt: "always respond in the scenario language".
- **No narrative arc** → 30 ticks with a mid-run trigger is the minimum to get pre/reaction/coalition/resolution; below 15 ticks everything collapses.

## Related guides

- [Simulation Time (Ticks)](/guide/ticks) — how tick scheduling and triggers work
- [Example Scenarios](/guide/example-scenarios) — ready-made scenarios to study
- [Studio Dashboard](/guide/studio) — watch your scenario live
