# Recinto degli Animali — Atteso

Mostra che le primitive di percezione funzionano fuori dal modello
"umani che chiacchierano".

## Cosa deve succedere

- Alpha, Beta, Gamma sono nello stesso settore (recinto-nord). Sentono i
  rispettivi richiami sonori (raggio 0.5 km è abbondante).
- Ovis è in recinto-sud (~70m). Riesce a vedere i lupi (sight 0.1 km)
  ma non a sentirli (sound 0.05 km).
- Quando Alpha "ulula", Beta e Gamma rispondono entro 1-2 tick. Ovis
  nota i lupi visibili e la sua need `fear` cresce.
- Nessun comando di scenario, nessuna conversazione esplicita: l'unico
  motore di accoppiamento è la percezione + attention.

## Metriche da osservare

- Alpha-Beta-Gamma formano almeno 1 topic con ≥3 messaggi.
- Ovis ha `actions.perceive` o `actions.observe` quando vede i lupi,
  ma non `speak` verso il branco (nessuno la sente).
- Nessuno scambio cross-recinto in `metrics.perception`.
