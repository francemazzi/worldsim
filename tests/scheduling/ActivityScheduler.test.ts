import { describe, it, expect, beforeEach } from "vitest";
import { ActivityScheduler } from "../../src/scheduling/ActivityScheduler.js";

describe("ActivityScheduler", () => {
  let scheduler: ActivityScheduler;

  beforeEach(() => {
    scheduler = new ActivityScheduler();
  });

  it("returns true when no schedule is provided", () => {
    expect(scheduler.shouldActivate("agent-1", 5, undefined)).toBe(true);
  });

  it("returns true when schedule has all defaults", () => {
    expect(scheduler.shouldActivate("agent-1", 5, {})).toBe(true);
  });

  describe("sleepCycle", () => {
    it("activates within the active window", () => {
      const schedule = { sleepCycle: { activeFrom: 0, activeTo: 8, period: 12 } };
      expect(scheduler.shouldActivate("a", 3, schedule)).toBe(true);
    });

    it("deactivates outside the active window", () => {
      const schedule = { sleepCycle: { activeFrom: 0, activeTo: 8, period: 12 } };
      expect(scheduler.shouldActivate("a", 9, schedule)).toBe(false);
    });

    it("handles wrapping cycles (activeFrom > activeTo)", () => {
      const schedule = { sleepCycle: { activeFrom: 20, activeTo: 8, period: 24 } };
      // Tick 22 -> position 22, activeFrom=20, activeTo=8, wrapping
      expect(scheduler.shouldActivate("a", 22, schedule)).toBe(true);
      // Tick 3 -> position 3, should be active (3 >= activeTo=8? no, 3 < 8 and 3 < activeFrom=20)
      // Wrapping: NOT (pos < activeFrom AND pos >= activeTo) => NOT (3 < 20 AND 3 >= 8) => NOT (true AND false) => true
      expect(scheduler.shouldActivate("a", 3, schedule)).toBe(true);
      // Tick 12 -> position 12, NOT (12 < 20 AND 12 >= 8) => NOT (true AND true) => false
      expect(scheduler.shouldActivate("a", 12, schedule)).toBe(false);
    });
  });

  describe("activeTickRatio", () => {
    it("is deterministic for same agent+tick", () => {
      const schedule = { activeTickRatio: 0.5 };
      const result1 = scheduler.shouldActivate("agent-1", 10, schedule);
      const result2 = scheduler.shouldActivate("agent-1", 10, schedule);
      expect(result1).toBe(result2);
    });

    it("with ratio 1.0 always activates", () => {
      const schedule = { activeTickRatio: 1.0 };
      for (let i = 0; i < 20; i++) {
        expect(scheduler.shouldActivate("a", i, schedule)).toBe(true);
      }
    });

    it("with ratio 0.0 never activates", () => {
      const schedule = { activeTickRatio: 0.0 };
      for (let i = 0; i < 20; i++) {
        expect(scheduler.shouldActivate("a", i, schedule)).toBe(false);
      }
    });

    it("produces roughly expected activation rate", () => {
      const schedule = { activeTickRatio: 0.5 };
      let activated = 0;
      const total = 1000;
      for (let i = 0; i < total; i++) {
        if (scheduler.shouldActivate("test-agent", i, schedule)) activated++;
      }
      // Allow wide margin for hash distribution
      expect(activated).toBeGreaterThan(300);
      expect(activated).toBeLessThan(700);
    });
  });

  describe("cooldownTicks", () => {
    it("allows first action without cooldown", () => {
      const schedule = { cooldownTicks: 3 };
      expect(scheduler.shouldActivate("a", 0, schedule)).toBe(true);
    });

    it("blocks during cooldown period", () => {
      const schedule = { cooldownTicks: 3 };
      scheduler.recordAction("a", 5);
      expect(scheduler.shouldActivate("a", 6, schedule)).toBe(false);
      expect(scheduler.shouldActivate("a", 7, schedule)).toBe(false);
    });

    it("allows after cooldown period", () => {
      const schedule = { cooldownTicks: 3 };
      scheduler.recordAction("a", 5);
      expect(scheduler.shouldActivate("a", 8, schedule)).toBe(true);
    });
  });

  describe("actionsPerHour", () => {
    it("allows actions within the limit", () => {
      const schedule = { actionsPerHour: 3 };
      scheduler.recordAction("a", 0);
      scheduler.recordAction("a", 1);
      expect(scheduler.shouldActivate("a", 2, schedule)).toBe(true);
    });

    it("blocks after exceeding the limit", () => {
      const schedule = { actionsPerHour: 2 };
      scheduler.recordAction("a", 0);
      scheduler.recordAction("a", 1);
      expect(scheduler.shouldActivate("a", 2, schedule)).toBe(false);
    });

    it("resets after hour period", () => {
      const schedule = { actionsPerHour: 2 };
      scheduler.recordAction("a", 0, 10); // hourPeriod = 10
      scheduler.recordAction("a", 1, 10);
      expect(scheduler.shouldActivate("a", 2, schedule)).toBe(false);
      // Record at tick 10 should reset the hour
      scheduler.recordAction("a", 10, 10);
      expect(scheduler.shouldActivate("a", 11, schedule)).toBe(true);
    });
  });
});
