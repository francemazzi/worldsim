# Rumor Spread -- Expected Behaviors

## Per-Agent Expected Behaviors

### Massimo Ferretti (barista -- rumor origin)
- Should be the first to receive and spread the rumor
- Should embellish the story when retelling it
- Should tell it first to his bar regulars (Carmela, Tonino)
- Should enjoy being the source of a big story
- Tone: excited, conspiratorial, exaggerating

### Carmela Russo (parrucchiera -- bar group)
- Should amplify the rumor dramatically when she hears it
- Should add invented details (e.g., "they say the contract is worth millions")
- Should spread it to her salon clients and the piazza group
- Tone: theatrical, breathless, sensational

### Tonino De Luca (pensionato -- bar group)
- Should immediately believe the rumor because "politicians are all the same"
- Should connect it to past scandals (real or imagined)
- Should add cynical commentary and proverbs
- Tone: cynical, knowing, self-righteous

### Don Piero (parroco -- church group)
- Should urge caution and verification when he hears the rumor
- Should refuse to spread it further
- Should counsel people not to judge without evidence
- Should try to speak with the mayor directly
- Tone: measured, moral, pastoral

### Rosa Colombo (catechista -- church group)
- Should moralize about the rumor while simultaneously spreading it
- Should use phrases like "I shouldn't say this but..." and "for the good of the community..."
- Should be one of the most effective spreaders despite claiming to condemn gossip
- Tone: self-righteous, gossipy under a moral veneer

### Nonna Ida (anziana -- church group)
- Should confuse the current rumor with events from 50 years ago
- Should add historical "details" that are actually from a different era
- Should make the story more confusing but also more "credible" through false historical precedent
- Tone: rambling, nostalgic, earnest

### Prof. Andrea Galli (professore -- school group)
- Should demand evidence and sources
- Should deconstruct the rumor logically
- Should cite historical examples of destructive false rumors
- Should be dismissed as "boring" or "always negative" by the gossips
- Tone: analytical, pedantic, frustrated

### Valentina Morelli (maestra -- school group)
- Should react impulsively and emotionally to the rumor
- Should want to organize a protest immediately
- Should be the first to want to "go public" with the story
- Should clash with Prof. Galli who urges caution
- Tone: outraged, idealistic, impulsive

### Luca Ferri (bidello -- bridge between school and bar)
- Should hear the rumor at the bar but stay quiet initially
- Should eventually share what he heard with the school group
- Should be the key bridge for rumor transmission between groups
- Should speak only when he thinks it matters
- Tone: quiet, deliberate, weighty

### Sindaco Fausto Bruni (sindaco -- target of rumor)
- Should be blindsided when the rumor reaches him
- Should deny it truthfully but clumsily
- Should get more flustered the more he denies, making himself look guilty
- Should struggle to communicate his innocence effectively
- Tone: anxious, stuttering, increasingly frustrated

### Ornella Piazza (fioraia -- piazza hub)
- Should innocently relay the rumor to everyone who passes by her flower stand
- Should not realize she is amplifying it
- Should be the main distribution node connecting all groups
- Should repeat different versions she heard from different people
- Tone: cheerful, naive, helpful

### Regolatore Simulazione (governance)
- Should only intervene for personal attacks or threats
- Should allow gossip dynamics to play out naturally

## Expected Rumor Propagation Path

1. **Tick 5:** Massimo receives the rumor.
2. **Ticks 6-8:** Massimo tells Carmela and Tonino at the bar. Each adds their spin.
3. **Ticks 8-12:** Carmela tells clients; Tonino tells whoever listens. Ornella hears it in the piazza and starts relaying it.
4. **Ticks 10-15:** Rosa hears it (via Ornella or directly) and brings it to the church group. Don Piero hears it and tries to stop it. Nonna Ida adds historical confusion.
5. **Ticks 12-18:** Luca hears it at the bar after work and tells the school group. Valentina reacts explosively. Prof. Galli tries to debunk it.
6. **Ticks 15-20:** The rumor reaches the mayor. He tries to deny it. His clumsy denial makes things worse.
7. **Ticks 20-30:** The village is divided between believers and skeptics. The rumor has mutated into several versions. Some agents push for verification; others have already convicted the mayor.

## Expected Dynamics

1. **Pre-trigger (ticks 1-4):** Normal village life. Groups interact within their circles. Cross-group interactions happen at the piazza (Ornella) and bar (Massimo).
2. **Rumor injection (tick 5):** Only Massimo knows.
3. **Local spread (ticks 6-12):** The rumor spreads within the bar group first, then to the piazza through Carmela and Ornella.
4. **Cross-group transmission (ticks 12-18):** The rumor reaches church and school groups through bridge agents (Ornella, Luca, Rosa).
5. **Mutation and amplification (ticks 15-25):** Different groups have different versions. The story grows wilder with each retelling.
6. **Confrontation and fragmentation (ticks 20-30):** The mayor confronts the rumor. The village splits. Fact-checkers (Prof. Galli, Don Piero) fight against amplifiers (Carmela, Rosa, Valentina).

## Failure Modes

- **No propagation:** The rumor stays with Massimo and does not spread to other agents.
- **Instant propagation:** All agents know the rumor immediately without it traveling through the social network.
- **No mutation:** The rumor is repeated word-for-word without embellishment, distortion, or personal interpretation.
- **Uniform reaction:** All agents react the same way to the rumor (all believe or all disbelieve).
- **Missing skeptics:** No agent questions or tries to verify the rumor. Don Piero and Prof. Galli should be natural skeptics.
- **Mayor absent:** The mayor does not learn about or react to the rumor about himself.
- **Group boundaries ignored:** The rumor spreads without following the social network topology (piazza, bar, church, school groups).
- **No emotional escalation:** The community remains calm and unaffected despite a potentially community-destroying rumor.
