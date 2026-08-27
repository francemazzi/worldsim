import { describe, it, expect } from "vitest";
import { TickContextLoader } from "../../src/agents/internal/TickContextLoader.js";
import { MessageBus } from "../../src/messaging/MessageBus.js";
import { NeedsTracker } from "../../src/needs/NeedsTracker.js";

describe("TickContextLoader active needs idle gate", () => {
  it("is not idle when active (non-critical) needs exist", () => {
    const bus = new MessageBus();
    bus.newTick(1);
    const tracker = new NeedsTracker();
    tracker.initFromTemplate("agent-1", "humanBasic");
    tracker.set("agent-1", {
      needs: tracker.get("agent-1")!.needs.map((n) =>
        n.id === "hunger" ? { ...n, value: 0.6 } : n,
      ),
    });

    const loader = new TickContextLoader("agent-1", bus, { needsTracker: tracker });
    const idle = loader.isIdle(1, {
      mood: "calmo",
      energy: 10,
      goals: [],
      beliefs: {},
      knowledge: {},
    });
    expect(idle).toBe(false);
  });
});
