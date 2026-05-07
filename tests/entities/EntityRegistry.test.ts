import { describe, it, expect } from "vitest";
import { InMemoryEntityRegistry } from "../../src/entities/InMemoryEntityRegistry.js";
import { AffordanceResolver } from "../../src/entities/AffordanceResolver.js";
import type { Entity } from "../../src/types/EntityTypes.js";
import type { Percept } from "../../src/types/PerceptionTypes.js";
import { createStimulusId } from "../../src/perception/StimulusBus.js";

function makeEntity(overrides: Partial<Entity> & { id: string }): Entity {
  return {
    kind: "object",
    ...overrides,
  };
}

describe("InMemoryEntityRegistry", () => {
  it("adds, gets and lists by kind", () => {
    const reg = new InMemoryEntityRegistry();
    reg.add(makeEntity({ id: "apple-1", kind: "object", subKind: "apple" }));
    reg.add(makeEntity({ id: "wolf-1", kind: "animal", subKind: "wolf" }));
    reg.add(makeEntity({ id: "wolf-2", kind: "animal", subKind: "wolf" }));

    expect(reg.size).toBe(3);
    expect(reg.list({ kind: "animal" })).toHaveLength(2);
    expect(reg.list({ kind: "animal", subKind: "wolf" })).toHaveLength(2);
    expect(reg.get("apple-1")?.subKind).toBe("apple");
  });

  it("removes entities and cleans the kind index", () => {
    const reg = new InMemoryEntityRegistry();
    reg.add(makeEntity({ id: "apple-1", kind: "object" }));
    reg.remove("apple-1");
    expect(reg.size).toBe(0);
    expect(reg.list({ kind: "object" })).toHaveLength(0);
  });
});

describe("AffordanceResolver", () => {
  function makePercept(entityId: string): Percept {
    return {
      stimulus: {
        id: createStimulusId(),
        kind: "sight",
        channel: "sight",
        source: { kind: "entity", id: entityId },
        tick: 1,
        intensity: 0.8,
        payload: {},
      },
      via: "sight",
      distanceKm: 0.01,
      perceivedIntensity: 0.8,
      tick: 1,
    };
  }

  it("returns affordances for entities in the percept set", () => {
    const reg = new InMemoryEntityRegistry();
    reg.add({
      id: "apple-1",
      kind: "object",
      subKind: "apple",
      affordances: [
        { verb: "eat", produces: ["satiety"] },
        { verb: "throw" },
      ],
    });

    const resolver = new AffordanceResolver({ entityRegistry: reg });
    const out = resolver.fromPercepts([makePercept("apple-1")]);
    expect(out).toHaveLength(2);
    expect(out.map((a) => a.affordance.verb).sort()).toEqual(["eat", "throw"]);
  });

  it("returns no affordances when the entity is not perceived", () => {
    const reg = new InMemoryEntityRegistry();
    reg.add({
      id: "apple-1",
      kind: "object",
      affordances: [{ verb: "eat" }],
    });

    const resolver = new AffordanceResolver({ entityRegistry: reg });
    expect(resolver.fromPercepts([])).toHaveLength(0);
  });

  it("hasAffordance is true when the entity offers the verb", () => {
    const reg = new InMemoryEntityRegistry();
    reg.add({
      id: "chair-1",
      kind: "object",
      affordances: [{ verb: "sit" }],
    });

    const resolver = new AffordanceResolver({ entityRegistry: reg });
    expect(resolver.hasAffordance([makePercept("chair-1")], "sit")).toBe(true);
    expect(resolver.hasAffordance([makePercept("chair-1")], "eat")).toBe(false);
  });
});
