# Pre-test campagne Meta — 100 utenti simulati

**Caso d'uso:** un'agenzia performance deve lanciare una campagna Meta per **FitPulse Pro**, startup milanese che vende un'app fitness in abbonamento (9,99€/mese, prova gratuita 7 giorni). Budget media: **12.000€/mese**. Target: Italia, 25–45 anni, interessi salute e benessere.

Prima di spendere in auction, il team vuole capire:

- Quale **copy** genera interesse reale vs scroll passivo
- Quali **obiezioni** emergono (prezzo, abbonamento, privacy, “coach AI”)
- Se l'annuncio **si diffonde** tra amici o muore nel feed
- Quali **segmenti** convertono e quali lo ignorano

WorldSim simula **100 utenti italiani** con profili, reddito e atteggiamento verso le ads — e produce un report strutturato in ~15 minuti, per **~$5 di API** invece di un focus group da migliaia di euro.

---

## Il brief (scenario reale)

| Campo | Valore |
| --- | --- |
| Cliente | FitPulse S.r.l. — app iOS/Android, 40k utenti attivi |
| Obiettivo campagna | Acquisizione trial → abbonamento |
| Canale | Meta (Feed Instagram + Facebook) |
| Copy in test | *“Trasforma la tua routine: FitPulse Pro ti guida con allenamenti personalizzati, tracking calorie e coach AI. Prova gratis 7 giorni, poi 9,99€/mese. Cancelli quando vuoi.”* |
| KPI attesi | CTR > 1,2%, CPA trial < 18€ |
| Rischio da validare | Abbonamento ricorrente + “coach AI” possono generare diffidenza |

La simulazione modella **2 ore di scroll social** (20 tick). Al **tick 3** l'annuncio entra nel feed di tutti — come un impression Meta reale.

---

## Cosa consegni al cliente

Dopo il run, `results/report.json` e la console riassumono deliverable utilizzabili in pitch e deck:

### 1. Distribuzione reazioni (archetypes)

Proxy comportamentali mappabili su funnel ads:

| Archetype | Interpretazione commerciale | Azione suggerita |
| --- | --- | --- |
| `compliant` | Interesse, valuta la prova gratuita | Retargeting, landing con CTA trial |
| `skeptic` | Dubita di prezzo, AI o dati | FAQ, social proof, comparazione prezzi |
| `resistant` | Rifiuto esplicito, possibile commento negativo | Escludere dal lookalike, monitorare brand safety |
| `apathetic` | Scroll senza engagement | Testare hook visivo / headline alternativa |

### 2. Shock analysis (pre vs post ad)

Metriche **prima** dell'impression (tick 1–2) vs **dopo** (tick 3+):

- **Speak rate** — l'ad genera conversazione? (passaparola simulato)
- **Mood / energy** — engagement o fastidio?
- **Recovery ticks** — quanto dura l'effetto nel feed?

### 3. Diffusione organica (network + dialogue)

- Chi parla con chi dopo l'ad (matrice dialoghi)
- Comunità e densità del grafo sociale
- Segmenti che amplificano vs che zittiscono

### 4. Costi e tempi

| | Focus group tradizionale | WorldSim (questo demo) |
| --- | --- | --- |
| Partecipanti | 8–12 persone | 100 profili segmentati |
| Tempo | 2–4 settimane organizzazione | ~15 minuti |
| Costo | 2.000–8.000€ | ~$3–8 API + infra |
| Output | Note qualitative | JSON + metriche + Studio dashboard |

---

## Esempio di insight da presentare

Output indicativo (ogni run varia per natura LLM):

```
Archetypes:  compliant 14% | skeptic 31% | resistant 11% | apathetic 44%

Shock: speak rate +38% post-ad → l'annuncio genera discussione
       mood shift negativo netto → obiezione dominante: abbonamento ricorrente

Segmenti: budget_conscious e privacy_skeptic concentrano il 68% degli scettici
          fitness_enthusiast divide: confronto con Strava/MyFitnessPal

Raccomandazione: testare variant B con prezzo upfront (“meno di un caffè al giorno”)
                 e rimuovere “coach AI” dalla headline per segmento privacy
```

Questi insight **non sostituiscono** un A/B test live, ma riducono il rischio di bruciare budget su copy che fallisce in silenzio.

---

## Segmenti simulati (100 agenti)

Popolazione allineata a un audience Meta tipico per fitness D2C:

| Segmento | % | Profilo | Comportamento atteso |
| --- | --- | --- | --- |
| Early adopter | 15% | Prova app nuove, sensibile al trial | Clic intent, domande su feature |
| Scettico privacy | 20% | Diffida di ads e tracking | Obiezioni su dati e “coach AI” |
| Budget-conscious | 25% | Confronta prezzo/valore | “9,99€/mese” è il trigger principale |
| Fitness enthusiast | 20% | Già usa Strava, MyFitnessPal | Comparazione feature, churn risk |
| Apatico scroll | 20% | Feed per abitudine | Ignora, basso CTR simulato |

Agenti organizzati in **5 cerchie sociali** (~20 persone) — amici, colleghi, famiglia — così le reazioni si propagano come passaparola, non solo impression isolata.

---

## Esecuzione

### Prerequisiti

- Node.js 20+
- `OPENAI_API_KEY` o `OPENROUTER_API_KEY`

```bash
export OPENAI_API_KEY=sk-...
# oppure OpenRouter
export OPENROUTER_API_KEY=sk-or-v1-...
export LLM_MODEL=openai/gpt-4o-mini
```

### Run

```bash
# Headless — consigliato per report e export
npx tsx examples/meta-ads-demo/index.ts

# Con dashboard live per demo al cliente
STUDIO=1 npx tsx examples/meta-ads-demo/index.ts
# → http://localhost:4400
```

Report completo: `examples/meta-ads-demo/results/report.json`

---

## Flusso simulato

```
Tick 1–2   Scroll normale, chat nei gruppi sociali
Tick 3     Annuncio Meta in feed → broadcast a tutti gli agenti
Tick 4–20  Reazioni individuali + discussione tra contatti
Fine       Report con archetypes, shock, network, costi
```

---

## Configurazione tecnica (100 agenti)

Parametri ottimizzati per costo/latency su campagne reali:

- `maxConcurrentAgents: 10` — rispetta rate limit OpenAI
- `defaultActiveTickRatio: 0.15` — ~15 utenti attivi/tick (realistico vs scroll passivo)
- `llmTier: "light"` + `iterationsPerTick: 1` — un ragionamento per tick
- `enableResponseCache: true` — riduce costo su profili simili

---

## Personalizzazione per altri clienti

Modifica `scenario.json` per replicare il workflow su qualsiasi vertical:

| Campo | Esempio alternativo |
| --- | --- |
| `trigger.announcement` | Copy variant B per A/B simulato |
| `product.priceMonthlyEur` | 19,99€ skincare, 4,99€ news app |
| `segments[]` | Pesi audience Meta (lookalike, retargeting) |
| `agentCount` | 20 per smoke test, 500+ con scaling docs |

Per test rapidi in call commerciale: imposta `agentCount: 20` in `scenario.json`.

---

## Struttura file

```
examples/meta-ads-demo/
├── scenario.json       # brief campagna, copy, segmenti
├── generate-agents.ts  # 100 profili + gruppi sociali
├── index.ts            # runner + broadcast ad + report
├── results/            # report.json (generato)
└── README.md
```

---

## Limitazioni (da comunicare al cliente)

- Simulazione **qualitativa** con LLM: esplora dinamiche e obiezioni, **non predice CTR/CPA numerici**.
- Ogni run varia: per decisioni ad budget alto, eseguire 2–3 run o abbassare `temperature`.
- Non sostituisce test A/B su Meta Ads Manager — lo **precede** per eliminare copy deboli.

---

## Prossimi passi (roadmap)

- A/B simulato: due copy nello stesso run, confronto archetypes
- Export slide-ready per agenzie
- Spostamento in `evaluation/scenarios/meta-ads/` per regression testing
