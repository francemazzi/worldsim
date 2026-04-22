import { describe, it, expect } from "vitest";
import { moodValence } from "../../src/analysis/moodValence.js";

describe("moodValence", () => {
  it("returns 0 for unknown or empty labels", () => {
    expect(moodValence(undefined)).toBe(0);
    expect(moodValence(null)).toBe(0);
    expect(moodValence("")).toBe(0);
    expect(moodValence("xyz")).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(moodValence("HAPPY")).toBeCloseTo(0.8, 2);
    expect(moodValence("Felice")).toBeCloseTo(0.8, 2);
  });

  it("assigns positive valence to positive moods and negative to negative", () => {
    expect(moodValence("sereno")).toBeGreaterThan(0);
    expect(moodValence("eccitato")).toBeGreaterThan(moodValence("sereno"));
    expect(moodValence("triste")).toBeLessThan(0);
    expect(moodValence("furioso")).toBeLessThan(moodValence("triste"));
  });
});
