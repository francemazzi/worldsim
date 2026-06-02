# Meta campaign pre-test — 100 simulated users

**Use case:** a performance agency is launching a Meta campaign for **FitPulse Pro**, a Milan-based startup selling a fitness subscription app (€9.99/month, 7-day free trial). Media budget: **€12,000/month**. Target: Italy, ages 25–45, health and wellness interests.

Before spending on auction, the team needs to know:

- Which **copy** drives real interest vs passive scrolling
- Which **objections** emerge (price, subscription, privacy, “AI coach”)
- Whether the ad **spreads** among friends or dies in the feed
- Which **segments** convert and which ignore it

WorldSim simulates **100 Italian users** with profiles, income, and attitudes toward ads — and produces a structured report in ~15 minutes for **~$5 in API costs** instead of a focus group costing thousands.

---

## The brief (realistic scenario)

| Field | Value |
| --- | --- |
| Client | FitPulse S.r.l. — iOS/Android app, 40k active users |
| Campaign goal | Trial acquisition → subscription |
| Channel | Meta (Instagram + Facebook Feed) |
| Copy under test | *“Transform your routine: FitPulse Pro guides you with personalized workouts, calorie tracking, and an AI coach. Try free for 7 days, then €9.99/month. Cancel anytime.”* |
| Expected KPIs | CTR > 1.2%, trial CPA < €18 |
| Risk to validate | Recurring subscription + “AI coach” may trigger distrust |

The simulation models **2 hours of social scrolling** (20 ticks). At **tick 3** the ad enters everyone’s feed — like a real Meta impression.

---

## Client deliverables

After the run, `results/report.json` and the console summarize pitch-ready deliverables:

### 1. Reaction distribution (archetypes)

Behavioral proxies mappable to ad funnel stages:

| Archetype | Commercial interpretation | Suggested action |
| --- | --- | --- |
| `compliant` | Interest, evaluating free trial | Retargeting, trial CTA landing page |
| `skeptic` | Doubts price, AI, or data use | FAQ, social proof, price comparison |
| `resistant` | Explicit rejection, possible negative comment | Exclude from lookalike, monitor brand safety |
| `apathetic` | Scrolls without engagement | Test visual hook / alternative headline |

### 2. Shock analysis (pre vs post ad)

Metrics **before** the impression (ticks 1–2) vs **after** (ticks 3+):

- **Speak rate** — does the ad spark conversation? (simulated word-of-mouth)
- **Mood / energy** — engagement or annoyance?
- **Recovery ticks** — how long does the effect last in the feed?

### 3. Organic diffusion (network + dialogue)

- Who talks to whom after the ad (dialogue matrix)
- Communities and social graph density
- Segments that amplify vs go silent

### 4. Cost and time

| | Traditional focus group | WorldSim (this demo) |
| --- | --- | --- |
| Participants | 8–12 people | 100 segmented profiles |
| Time | 2–4 weeks to organize | ~15 minutes |
| Cost | €2,000–8,000 | ~$3–8 API + infra |
| Output | Qualitative notes | JSON + metrics + Studio dashboard |

---

## Sample insight for a client deck

Indicative output (each run varies due to LLM nature):

```
Archetypes:  compliant 14% | skeptic 31% | resistant 11% | apathetic 44%

Shock: speak rate +38% post-ad → the ad sparks discussion
       net negative mood shift → dominant objection: recurring subscription

Segments: budget_conscious and privacy_skeptic account for 68% of skeptics
          fitness_enthusiast split: comparison with Strava/MyFitnessPal

Recommendation: test variant B with upfront pricing (“less than a coffee a day”)
                 and remove “AI coach” from the headline for the privacy segment
```

These insights **do not replace** a live A/B test, but reduce the risk of burning budget on copy that fails silently.

---

## Simulated segments (100 agents)

Population aligned with a typical Meta audience for fitness D2C:

| Segment | % | Profile | Expected behavior |
| --- | --- | --- | --- |
| Early adopter | 15% | Tries new apps, sensitive to trial | Click intent, feature questions |
| Privacy skeptic | 20% | Distrusts ads and tracking | Objections about data and “AI coach” |
| Budget-conscious | 25% | Compares price vs value | “€9.99/month” is the main trigger |
| Fitness enthusiast | 20% | Already uses Strava, MyFitnessPal | Feature comparison, churn risk |
| Passive scroller | 20% | Feed out of habit | Ignores, low simulated CTR |

Agents are organized in **5 social circles** (~20 people each) — friends, colleagues, family — so reactions propagate as word-of-mouth, not just isolated impressions.

---

## Running the demo

### Prerequisites

- Node.js 20+
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY`

```bash
export OPENAI_API_KEY=sk-...
# or OpenRouter
export OPENROUTER_API_KEY=sk-or-v1-...
export LLM_MODEL=openai/gpt-4o-mini
```

### Run

```bash
# Headless — recommended for report and export
npx tsx examples/meta-ads-demo/index.ts

# With live dashboard for client demos
STUDIO=1 npx tsx examples/meta-ads-demo/index.ts
# → http://localhost:4400
```

Full report: `examples/meta-ads-demo/results/report.json`

---

## Simulated flow

```
Ticks 1–2   Normal scrolling, chat within social groups
Tick 3      Meta ad in feed → broadcast to all agents
Ticks 4–20  Individual reactions + discussion among contacts
End         Report with archetypes, shock, network, costs
```

---

## Technical configuration (100 agents)

Parameters optimized for cost and latency on real campaigns:

- `maxConcurrentAgents: 10` — respects OpenAI rate limits
- `defaultActiveTickRatio: 0.15` — ~15 active users/tick (realistic vs passive scrolling)
- `llmTier: "light"` + `iterationsPerTick: 1` — one reasoning step per tick
- `enableResponseCache: true` — reduces cost on similar profiles

---

## Customization for other clients

Edit `scenario.json` to replicate the workflow for any vertical:

| Field | Alternative example |
| --- | --- |
| `trigger.announcement` | Copy variant B for simulated A/B |
| `product.priceMonthlyEur` | €19.99 skincare, €4.99 news app |
| `segments[]` | Meta audience weights (lookalike, retargeting) |
| `agentCount` | 20 for smoke tests, 500+ with scaling docs |

For quick tests on sales calls: set `agentCount: 20` in `scenario.json`.

---

## File structure

```
examples/meta-ads-demo/
├── scenario.json       # campaign brief, copy, segments
├── generate-agents.ts  # 100 profiles + social groups
├── index.ts            # runner + ad broadcast + report
├── results/            # report.json (generated)
└── README.md
```

---

## Limitations (communicate to clients)

- **Qualitative** LLM simulation: explores dynamics and objections, **does not predict numeric CTR/CPA**.
- Each run varies: for high-budget decisions, run 2–3 times or lower `temperature`.
- Does not replace A/B testing in Meta Ads Manager — it **precedes** it to eliminate weak copy.

---

## Roadmap

- Simulated A/B: two copy variants in one run, compare archetypes
- Slide-ready export for agencies
- Move to `evaluation/scenarios/meta-ads/` for regression testing
