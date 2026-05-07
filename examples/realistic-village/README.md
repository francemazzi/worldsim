# Borgo Realistico — Perception Demo

A small, runnable showcase of WorldSim's realistic-simulation primitives:

- **Perception mode** (`interaction.mode = "perception"`): every `speak`
  becomes a `Stimulus`, only agents whose senses pick it up actually
  receive it.
- **Default needs template** (`humanBasic`): every agent gets hunger,
  thirst, fatigue and social needs that decay each tick.
- **`NeedsSatisfierPlugin`**: closes the loop by reducing the matching
  need when agents act on it (eat, drink, rest, talk).
- **Two passive entities**: a bell that rings every five ticks (range
  150m) and a fountain that murmurs continuously (range 30m). Both
  emit on the `sound` channel.
- **Studio dashboard**: live "Perception" panel showing stimuli,
  topics, percepts and per-agent need bars.

The four agents are spread across three locations:

| Agent | Location  | Notes                                                |
|-------|-----------|------------------------------------------------------|
| Lucia | piazza    | hears bell + fountain, has hunger/thirst/social      |
| Marco | bar       | next to Pietro, loves fishing, only thirst declared  |
| Pietro| bar       | next to Marco, low distractibility (focused listener)|
| Anna  | casa      | ~250m from piazza, mostly out of range — by design   |

Anna is intentionally out of range to demonstrate that **silence is a
valid outcome**: when nothing reaches her senses, she just `perceives`
without forcing replies.

## Prerequisites

- Node.js ≥ 20
- `npm install`
- An OpenAI-compatible API key (env `OPENAI_API_KEY`)

## Run

```bash
OPENAI_API_KEY=sk-... npm run demo:realistic
```

Optional environment variables:

| Var            | Default                       |
|----------------|-------------------------------|
| `LLM_BASE_URL` | `https://api.openai.com/v1`   |
| `LLM_MODEL`    | `gpt-4o-mini`                 |
| `STUDIO_PORT`  | `4400`                        |

## What to look for

1. The **Perception** sidebar in the dashboard. Each tick:
   - the *Stimuli* table shows what was emitted (speech, bell, fountain),
   - the *Topics* table shows open conversation threads with their
     participants,
   - clicking an agent reveals what they actually heard *and* their
     current need bars.

2. The console summary at the end prints:
   - `replyRate`: how many speech stimuli got an in-thread reply,
   - `causalCoherence`: how many speeches were causally linked to a
     parent (high = real conversations, low = parallel monologues),
   - per-agent action breakdown including the new `perceive` bucket.

## Compare with legacy mode

To verify how much the perception layer helps, run the same scenario in
legacy mode and compare:

```bash
# Force legacy mode by tweaking interaction.mode in scenario.json
# or use the eval comparison script:
npm run eval:compare-perception
```

You should see fewer total speaks but a higher `causalCoherence` in
perception mode — agents are quieter but on-topic.
