/**
 * Maps a free-form mood label to a valence in [-1, 1].
 *
 * Used by sociological analyzers to turn categorical mood strings into a
 * numeric signal for variance, correlation and contagion computations.
 * Unknown labels default to 0 (neutral).
 *
 * Covers both English and Italian variants since scenarios in this repo
 * frequently use Italian personalities and mood vocabulary.
 */
const VALENCE_TABLE: Record<string, number> = {
  // Neutral
  neutral: 0,
  neutro: 0,
  neutra: 0,
  thoughtful: 0.1,
  riflessivo: 0.1,
  riflessiva: 0.1,
  curious: 0.2,
  curioso: 0.2,
  curiosa: 0.2,

  // Positive
  happy: 0.8,
  felice: 0.8,
  contento: 0.7,
  contenta: 0.7,
  excited: 0.9,
  eccitato: 0.9,
  eccitata: 0.9,
  entusiasta: 0.9,
  calm: 0.5,
  calmo: 0.5,
  calma: 0.5,
  sereno: 0.6,
  serena: 0.6,
  hopeful: 0.6,
  speranzoso: 0.6,
  speranzosa: 0.6,
  optimistic: 0.7,
  ottimista: 0.7,
  determined: 0.5,
  determinato: 0.5,
  determinata: 0.5,

  // Negative
  sad: -0.6,
  triste: -0.6,
  angry: -0.9,
  arrabbiato: -0.9,
  arrabbiata: -0.9,
  furioso: -1,
  furiosa: -1,
  anxious: -0.5,
  ansioso: -0.5,
  ansiosa: -0.5,
  preoccupato: -0.4,
  preoccupata: -0.4,
  worried: -0.4,
  frustrated: -0.6,
  frustrato: -0.6,
  frustrata: -0.6,
  irritated: -0.4,
  irritato: -0.4,
  irritata: -0.4,
  pessimistic: -0.5,
  pessimista: -0.5,
  resigned: -0.3,
  rassegnato: -0.3,
  rassegnata: -0.3,
};

/** Returns the valence of a mood label in [-1, 1]; 0 when unknown. */
export function moodValence(mood: string | undefined | null): number {
  if (!mood) return 0;
  return VALENCE_TABLE[mood.toLowerCase()] ?? 0;
}

/** Returns a pretty label used for display (first variant matched). */
export function knownMoodLabels(): string[] {
  return Object.keys(VALENCE_TABLE);
}
