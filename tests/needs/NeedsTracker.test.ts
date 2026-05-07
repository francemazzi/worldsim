import { describe, it, expect } from "vitest";
import { NeedsTracker } from "../../src/needs/NeedsTracker.js";

describe("NeedsTracker", () => {
  it("initializes from a humanBasic template", () => {
    const tracker = new NeedsTracker();
    tracker.initFromTemplate("alice", "humanBasic");
    const ns = tracker.get("alice");
    expect(ns).toBeTruthy();
    expect(ns!.needs.find((n) => n.id === "hunger")).toBeTruthy();
    expect(ns!.needs.find((n) => n.id === "thirst")).toBeTruthy();
  });

  it("initializes from a custom NeedsState", () => {
    const tracker = new NeedsTracker();
    tracker.initFromConfig("bob", {
      needs: [{ id: "curiosity", value: 0.4, tags: ["mystery"] }],
    });
    const ns = tracker.get("bob");
    expect(ns!.needs).toHaveLength(1);
    expect(ns!.needs[0]!.id).toBe("curiosity");
  });

  it("decays inactive needs over ticks", () => {
    const tracker = new NeedsTracker();
    tracker.initFromConfig("alice", {
      needs: [{ id: "hunger", value: 0.0, decayPerTick: 0.1 }],
    });
    for (let i = 0; i < 5; i++) tracker.tick("alice");
    const ns = tracker.get("alice")!;
    expect(ns.needs[0]!.value).toBeCloseTo(0.5, 5);
  });

  it("regenerates on satisfy() applied at next tick", () => {
    const tracker = new NeedsTracker();
    tracker.initFromConfig("alice", {
      needs: [{ id: "hunger", value: 0.8, decayPerTick: 0 }],
    });
    tracker.satisfy("alice", "hunger", 0.5);
    tracker.tick("alice");
    expect(tracker.get("alice")!.needs[0]!.value).toBeCloseTo(0.3, 5);
  });

  it("clamps values to [0, 1]", () => {
    const tracker = new NeedsTracker();
    tracker.initFromConfig("alice", {
      needs: [{ id: "hunger", value: 0.9, decayPerTick: 1 }],
    });
    tracker.tick("alice");
    expect(tracker.get("alice")!.needs[0]!.value).toBe(1);

    tracker.adjust("alice", "hunger", -10);
    expect(tracker.get("alice")!.needs[0]!.value).toBe(0);
  });

  it("activeNeeds returns those above their activationThreshold", () => {
    const tracker = new NeedsTracker();
    tracker.initFromConfig("alice", {
      needs: [
        { id: "hunger", value: 0.7, activationThreshold: 0.5 },
        { id: "thirst", value: 0.2, activationThreshold: 0.5 },
      ],
    });
    const active = tracker.activeNeeds("alice");
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe("hunger");
  });

  it("dynamicGoals derives goals from active needs", () => {
    const tracker = new NeedsTracker();
    tracker.initFromConfig("alice", {
      needs: [
        { id: "hunger", value: 0.95, activationThreshold: 0.5, criticalThreshold: 0.9 },
      ],
    });
    const goals = tracker.dynamicGoals("alice");
    expect(goals.length).toBeGreaterThan(0);
    expect(goals[0]).toMatch(/cibo|subito/i);
  });
});
