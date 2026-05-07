# Piano Ufficio — Atteso

Mostra che le "stanze" si simulano gratuitamente con il perception
layer.

## Cosa deve succedere

- Giulia (CEO) e Marco (CFO) chiacchierano in sala-A. Nessun agente
  dell'open space sente i loro speech (raggio 8m, distanza ~50m).
- Sara, Luca, Elena, Sofia sono nell'open space e si sentono tra loro.
- Elena con `perceptionFloor: 0.7` ignora la maggior parte del rumore
  ambientale: filtra solo speech molto vicini/forti.
- Sofia (alta `distractibility: 0.8`) capta più stimoli degli altri.

## Metriche da osservare

- `metrics.perception.totalTopics` ≥ 2 (uno in sala-A, uno open space).
- 0 percetti incrociati sala-A ↔ open space.
- Elena ha pochi topic come partecipante.
- Sofia ha molti `actions.perceive` (osservatrice).
