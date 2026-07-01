import { describe, it, expect } from "vitest";
import {
  structuredNeedsSatisfyRules,
  NeedsSatisfierPlugin,
} from "../../src/plugins/built-in/NeedsSatisfierPlugin.js";
import { NeedsTracker } from "../../src/needs/NeedsTracker.js";
import type { AgentAction } from "../../src/types/AgentTypes.js";

describe("structuredNeedsSatisfyRules", () => {
  it("matches affordance verb on interact", () => {
    const rules = structuredNeedsSatisfyRules();
    const rule = rules.find((r) => r.id === "affordance-verb")!;
    const action: AgentAction = {
      agentId: "a1",
      actionType: "interact",
      payload: { affordanceVerb: "drink", entityId: "fountain" },
      tick: 1,
    };
    expect(rule.match(action, {})).toBe(true);
  });

  it("matches tool energyRestored in payload", () => {
    const rules = structuredNeedsSatisfyRules();
    const rule = rules.find((r) => r.id === "tool-energy-restored")!;
    const action: AgentAction = {
      agentId: "a1",
      actionType: "interact",
      payload: { energyRestored: 25 },
      tick: 1,
    };
    expect(rule.match(action, {})).toBe(true);
  });
});

describe("NeedsSatisfierPlugin structured satisfaction", () => {
  it("lowers thirst via affordance verb", async () => {
    const tracker = new NeedsTracker();
    tracker.initFromTemplate("a1", "humanBasic");
    tracker.set("a1", {
      needs: tracker.get("a1")!.needs.map((n) =>
        n.id === "thirst" ? { ...n, value: 0.8 } : n,
      ),
    });

    const plugin = new NeedsSatisfierPlugin();
    (plugin as unknown as { needsTracker: NeedsTracker }).needsTracker = tracker;

    await plugin.onAgentAction(
      {
        agentId: "a1",
        actionType: "interact",
        payload: { affordanceVerb: "drink", entityId: "fountain" },
        tick: 1,
      },
      { agentId: "a1", status: "running", currentMessages: [], loopCount: 0, ephemeralMemory: {} },
    );

    tracker.tick("a1");

    const thirst = tracker.get("a1")!.needs.find((n) => n.id === "thirst")!;
    expect(thirst.value).toBeLessThan(0.8);
  });
});
