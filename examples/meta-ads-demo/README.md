# Meta Ads Demo — 100 utenti

Simulazione di **100 utenti italiani** che scrollano sui social. Al **tick 3** compare un annuncio Meta per **FitPulse Pro** (app fitness SaaS, 9,99€/mese, prova gratuita 7 giorni). Gli agenti reagiscono in modo differenziato per segmento demografico e la conversazione può propagarsi nei gruppi sociali.

## Prerequisiti

- Node.js 20+
- Chiave API OpenAI o OpenRouter

```bash
export OPENAI_API_KEY=sk-...
# oppure
export OPENROUTER_API_KEY=sk-or-v1-...
export LLM_MODEL=openai/gpt-4o-mini   # solo con OpenRouter
```

## Esecuzione

```bash
# Run headless (consigliato, ~5–15 min)
npx tsx examples/meta-ads-demo/index.ts

# Con dashboard live
STUDIO=1 npx tsx examples/meta-ads-demo/index.ts
# → http://localhost:4400
```

Il report completo viene salvato in `examples/meta-ads-demo/results/report.json`.

## Cosa succede nella simulazione

| Fase | Tick | Comportamento |
| --- | --- | --- |
| Pre-ad | 1–2 | Scroll normale, interazioni nei 5 gruppi sociali (~20 agenti ciascuno) |
| Ad trigger | 3 | L'annuncio viene **broadcastato** a tutti via `MessageBus` |
| Post-ad | 4–20 | Reazioni individuali + discussione tra amici del gruppo |

## Segmenti utente (100 agenti)

| Segmento | % | Comportamento atteso |
| --- | --- | --- |
| Early adopter | 15% | Curiosità, possibile interesse per la prova gratuita |
| Scettico privacy | 20% | Diffidenza verso ads e dati |
| Budget-conscious | 25% | Valuta prezzo vs beneficio dell'abbonamento |
| Fitness enthusiast | 20% | Confronta con app già usate (Strava, MyFitnessPal) |
| Apatico scroll | 20% | Ignora o scrolla oltre |

## Configurazione engine

Per contenere costi e rate limit con 100 agenti:

- `maxConcurrentAgents: 10`
- `defaultActiveTickRatio: 0.15` (~15 agenti attivi per tick)
- `llmTier: "light"` su ogni agente
- `iterationsPerTick: 1`
- `enableResponseCache: true`

## Interpretare i risultati

### Archetypes (proxy di reazione all'ad)

| Archetype | Significato nel contesto ads |
| --- | --- |
| `compliant` | Interesse, valutazione positiva, possibile intent di provare |
| `skeptic` | Dubbio, domande, valutazione critica |
| `resistant` | Reazione negativa, rifiuto esplicito |
| `apathetic` | Ignora, bassa attività, scroll oltre |

### Shock analysis

Confronta metriche **pre** (tick 1–2) vs **post** (tick 3+) dell'annuncio:

- **Speak rate**: aumento = più discussione sull'ad
- **Avg energy / mood**: segnali di engagement o fastidio
- **Recovery ticks**: quanto tempo per tornare al comportamento pre-ad

### Costo stimato

~300 chiamate LLM → **circa $3–8** con `gpt-4o-mini`, variabile in base alle risposte.

## Struttura file

```
examples/meta-ads-demo/
├── scenario.json       # timing, ad copy, segmenti, config engine
├── generate-agents.ts  # factory 100 profili + neighborhood groups
├── index.ts            # runner principale
├── results/            # report.json (generato a runtime)
└── README.md
```

## Limitazioni

- Simulazione **qualitativa** con LLM, non predizione statistica di CTR reali.
- Ogni run produce risultati diversi (temperature, variabilità del modello).
- Per regression testing strutturato, spostare lo scenario in `evaluation/scenarios/`.

## Personalizzazione

Modifica `scenario.json`:

- `trigger.announcement` — copy dell'annuncio
- `trigger.atTick` — quando appare l'ad
- `segments[]` — pesi e personalità dei segmenti
- `agentCount` — riduci a 10–20 per test rapidi (aggiorna anche `generate-agents.ts` se cambi la logica)
