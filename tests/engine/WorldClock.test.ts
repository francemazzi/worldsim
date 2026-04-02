import { describe, it, expect } from "vitest";
import { WorldClock } from "../../src/engine/WorldClock.js";

describe("WorldClock", () => {
  it("starts at tick 0", () => {
    const clock = new WorldClock();
    expect(clock.current()).toBe(0);
  });

  it("increment() advances and returns the new tick", () => {
    const clock = new WorldClock();
    expect(clock.increment()).toBe(1);
    expect(clock.increment()).toBe(2);
    expect(clock.current()).toBe(2);
  });

  it("elapsed() returns positive milliseconds", async () => {
    const clock = new WorldClock();
    await new Promise((r) => setTimeout(r, 50));
    expect(clock.elapsed()).toBeGreaterThanOrEqual(40);
  });

  it("reset() sets tick back to 0 and resets elapsed", async () => {
    const clock = new WorldClock();
    clock.increment();
    clock.increment();
    await new Promise((r) => setTimeout(r, 50));
    clock.reset();
    expect(clock.current()).toBe(0);
    expect(clock.elapsed()).toBeLessThan(30);
  });
});
