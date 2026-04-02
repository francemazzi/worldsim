import { describe, it, expect } from "vitest";
import { buildRulesContext } from "../../src/rules/RulesLoader.js";
import type { RuleSet } from "../../src/types/RulesTypes.js";

function makeSampleRuleSets(): RuleSet[] {
  return [
    {
      version: "1.0.0",
      name: "Set A",
      rules: [
        { id: "r1", priority: 10, scope: "person", instruction: "Be creative", enforcement: "soft" },
        { id: "r2", priority: 1, scope: "all", instruction: "Be respectful", enforcement: "hard" },
        { id: "r3", priority: 5, scope: "control", instruction: "Monitor rules", enforcement: "hard" },
        { id: "r4", priority: 20, scope: "world", instruction: "World limit", enforcement: "soft" },
      ],
      source: "json",
      loadedAt: new Date(),
    },
  ];
}

describe("RulesContext", () => {
  it("getRulesForScope('person') returns only 'person' + 'all' rules", () => {
    const ctx = buildRulesContext(makeSampleRuleSets());
    const personRules = ctx.getRulesForScope("person");

    expect(personRules.every((r) => r.scope === "person" || r.scope === "all")).toBe(true);
    expect(personRules).toHaveLength(2);
  });

  it("rules are sorted by priority ascending", () => {
    const ctx = buildRulesContext(makeSampleRuleSets());
    const personRules = ctx.getRulesForScope("person");

    for (let i = 1; i < personRules.length; i++) {
      expect(personRules[i]!.priority).toBeGreaterThanOrEqual(personRules[i - 1]!.priority);
    }
  });

  it("getRuleById returns undefined for non-existent id", () => {
    const ctx = buildRulesContext(makeSampleRuleSets());
    expect(ctx.getRuleById("nonexistent")).toBeUndefined();
    expect(ctx.getRuleById("r1")).toBeDefined();
  });
});
