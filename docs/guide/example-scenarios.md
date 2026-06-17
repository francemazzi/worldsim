# Example Scenarios

**Community Policy Impact** — 8 villagers face a new water rationing policy. The farmer resists, the mayor defends, the priest mediates, the technologist proposes solutions. Who forms coalitions? Who complies?

**Market Price Shocks** — 10 marketplace agents react when grain prices double overnight. Sellers profit, buyers protest, regulators intervene. Economic reasoning emerges from personality-driven agents.

**Information Cascades** — 12 agents in 4 social groups. A rumor starts with one person. Watch it spread (or not) through the social graph, distorted by each personality along the way.

See [`evaluation/`](https://github.com/francemazzi/worldsim/tree/main/evaluation) for repeatable scenarios with expected behaviors and quality criteria.

## Available scenarios

| Scenario | Focus |
| --- | --- |
| `water-rationing` | Community policy impact, governance agent |
| `price-shock` | Market dynamics, economic reasoning |
| `rumor-spread` | Information cascades across social groups |
| `village-realistic` | Perception layer, location and senses |
| `enclosure-animals` | Animal needs, non-agent entities |
| `office-floor` | Workplace dynamics with perception |

Run evaluation:

```bash
npm run eval
npm run eval:realistic
npm run eval:compare-perception
```
