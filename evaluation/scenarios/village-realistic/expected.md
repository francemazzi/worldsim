# Villaggio Realistico — Atteso

## Cosa deve succedere

- Marco e Pietro, entrambi al bar (~stessa coordinata), si sentono e
  possono conversare. Le loro risposte restano sullo stesso `topicId`.
- Lucia, in piazza (a oltre 50m dal bar), non sente Marco e Pietro
  parlare. Quando ha fame o ha bisogno di compagnia, il prompt può
  suggerire destinazioni utili (affordances/entity) se percepibili.
- Anna, a casa, non sente nulla dal bar/piazza. Se nessuno entra a casa
  sua, lavora in silenzio (`actionType: "perceive"` o `"observe"`).
- Marco interessato a "pesce/mare/barca" (interesse esplicito): se
  qualcuno parla di pesci, salta su anche con bassa intensità.
- Nessun agente "scaldato" finisce con risposte fuori topic: il
  TopicTracker e il prompt di percezione mantengono coerenza.

## Metriche da osservare nel report

- `metrics.perception.causalCoherence` ≥ 0.5 nelle interazioni
  bar-bar.
- `metrics.perception.replyRate` > 0 (almeno un topic con replies).
- `metrics.perception.totalTopics` ≥ 1.
- Lucia e Anna hanno `actions.perceive` >> `actions.speak`.

## Anti-pattern da NON osservare

- Anna che risponde a Marco mentre è a casa.
- Speech persi nel vuoto che attivano altri agenti distanti.
- Cambi di argomento bruschi (Marco parla di pesci → Pietro parla di
  politica) senza indicazione esplicita.
