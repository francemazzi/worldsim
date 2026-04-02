import { describe, it, expect, beforeEach } from "vitest";
import { TokenBudgetTracker } from "../../src/scheduling/TokenBudgetTracker.js";

describe("TokenBudgetTracker", () => {
  let tracker: TokenBudgetTracker;

  beforeEach(() => {
    tracker = new TokenBudgetTracker();
  });

  it("allows when no budget is set", () => {
    tracker.record("a", { inputTokens: 1000, outputTokens: 500 });
    expect(tracker.canProceed("a", undefined)).toEqual({ allowed: true, policy: "pause" });
  });

  it("allows when under budget", () => {
    tracker.record("a", { inputTokens: 100, outputTokens: 50 });
    const result = tracker.canProceed("a", { perTick: 200 });
    expect(result.allowed).toBe(true);
  });

  describe("perTick budget", () => {
    it("blocks when tick budget exceeded", () => {
      tracker.record("a", { inputTokens: 500, outputTokens: 600 });
      const result = tracker.canProceed("a", { perTick: 1000 });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Tick budget exceeded");
    });

    it("resets on new tick", () => {
      tracker.record("a", { inputTokens: 500, outputTokens: 600 });
      tracker.resetTick("a", 2);
      const result = tracker.canProceed("a", { perTick: 1000 });
      expect(result.allowed).toBe(true);
    });
  });

  describe("perHour budget", () => {
    it("blocks when hour budget exceeded", () => {
      tracker.record("a", { inputTokens: 3000, outputTokens: 3000 });
      const result = tracker.canProceed("a", { perHour: 5000 });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Hour budget exceeded");
    });

    it("resets on hour rollover", () => {
      tracker.record("a", { inputTokens: 3000, outputTokens: 3000 });
      tracker.resetHour("a", 60);
      const result = tracker.canProceed("a", { perHour: 5000 });
      expect(result.allowed).toBe(true);
    });
  });

  describe("lifetime budget", () => {
    it("blocks when lifetime budget exceeded", () => {
      tracker.record("a", { inputTokens: 500000, outputTokens: 600000 });
      const result = tracker.canProceed("a", { lifetime: 1000000 });
      expect(result.allowed).toBe(false);
    });

    it("lifetime tokens persist across resets", () => {
      tracker.record("a", { inputTokens: 500, outputTokens: 500 });
      tracker.resetTick("a", 1);
      tracker.resetHour("a", 60);
      const usage = tracker.getUsage("a");
      expect(usage?.lifetimeTokens).toBe(1000);
    });
  });

  describe("policy", () => {
    it("returns configured policy on budget exceeded", () => {
      tracker.record("a", { inputTokens: 1000, outputTokens: 1000 });
      const result = tracker.canProceed("a", { perTick: 100, policy: "stop" });
      expect(result.policy).toBe("stop");
    });

    it("defaults to pause policy", () => {
      tracker.record("a", { inputTokens: 1000, outputTokens: 1000 });
      const result = tracker.canProceed("a", { perTick: 100 });
      expect(result.policy).toBe("pause");
    });
  });

  describe("resetAllTicks", () => {
    it("resets tick counters for all agents", () => {
      tracker.record("a", { inputTokens: 500, outputTokens: 500 });
      tracker.record("b", { inputTokens: 300, outputTokens: 300 });
      tracker.resetAllTicks(1);
      expect(tracker.getUsage("a")?.tickTokens).toBe(0);
      expect(tracker.getUsage("b")?.tickTokens).toBe(0);
    });

    it("resets hour when period elapsed", () => {
      tracker.record("a", { inputTokens: 500, outputTokens: 500 });
      tracker.resetAllTicks(60, 60); // hourPeriod=60, currentTick=60
      expect(tracker.getUsage("a")?.hourTokens).toBe(0);
    });
  });
});
