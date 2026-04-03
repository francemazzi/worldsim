import { describe, it, expect, beforeEach } from "vitest";
import { RelationshipPlugin } from "../../src/plugins/built-in/RelationshipPlugin.js";
import { InMemoryGraphStore } from "../../src/stores/InMemoryGraphStore.js";
import type { WorldContext } from "../../src/types/WorldTypes.js";
import type { RelationshipMeta } from "../../src/plugins/built-in/RelationshipPlugin.js";

function makeCtx(tick: number): WorldContext {
  return { worldId: "test", tickCount: tick, startedAt: new Date(), metadata: {} };
}

describe("RelationshipPlugin", () => {
  let graphStore: InMemoryGraphStore;
  let plugin: RelationshipPlugin;
  let declare: (input: unknown, ctx: WorldContext) => Promise<unknown>;
  let witness: (input: unknown, ctx: WorldContext) => Promise<unknown>;
  let breakRel: (input: unknown, ctx: WorldContext) => Promise<unknown>;
  let check: (input: unknown, ctx: WorldContext) => Promise<unknown>;

  beforeEach(() => {
    graphStore = new InMemoryGraphStore();
    plugin = new RelationshipPlugin({ graphStore });
    declare = plugin.tools.find((t) => t.name === "declare_relationship")!.execute;
    witness = plugin.tools.find((t) => t.name === "witness_relationship")!.execute;
    breakRel = plugin.tools.find((t) => t.name === "break_relationship")!.execute;
    check = plugin.tools.find((t) => t.name === "check_relationship_status")!.execute;
  });

  describe("declare_relationship", () => {
    it("creates a proposed relationship", async () => {
      const result = (await declare(
        { from: "maria", target: "marco", type: "mother" },
        makeCtx(1),
      )) as { risultato: string; stato: string };

      expect(result.risultato).toBe("relazione_proposta");
      expect(result.stato).toBe("proposed");

      const rel = await graphStore.getRelationship("maria", "marco", "mother");
      expect(rel).not.toBeNull();
      expect(rel!.strength).toBe(0.3);
      const meta = rel!.metadata as unknown as RelationshipMeta;
      expect(meta.status).toBe("proposed");
      expect(meta.declaredBy).toEqual(["maria"]);
    });

    it("upgrades to mutual when both agents declare", async () => {
      // Maria declares
      await declare({ from: "maria", target: "marco", type: "mother" }, makeCtx(1));

      // Marco declares the same type back
      const result = (await declare(
        { from: "marco", target: "maria", type: "mother" },
        makeCtx(2),
      )) as { risultato: string; stato: string };

      expect(result.risultato).toBe("relazione_reciproca");
      expect(result.stato).toBe("mutual");

      // Both directions should be mutual
      const rel1 = await graphStore.getRelationship("maria", "marco", "mother");
      const rel2 = await graphStore.getRelationship("marco", "maria", "mother");
      expect(rel1).not.toBeNull();
      expect(rel2).not.toBeNull();
      expect(rel1!.strength).toBe(0.6);
      expect(rel2!.strength).toBe(0.6);
      expect((rel1!.metadata as unknown as RelationshipMeta).status).toBe("mutual");
      expect((rel2!.metadata as unknown as RelationshipMeta).status).toBe("mutual");
    });

    it("prevents self-relationship", async () => {
      const result = (await declare(
        { from: "maria", target: "maria", type: "friend" },
        makeCtx(1),
      )) as { errore: string };

      expect(result.errore).toBeDefined();
    });

    it("does not downgrade already validated relationships", async () => {
      // Seed a validated relationship
      await plugin.seedRelationships(
        [{ from: "maria", to: "marco", type: "mother" }],
        graphStore,
      );

      const result = (await declare(
        { from: "maria", target: "marco", type: "mother" },
        makeCtx(5),
      )) as { risultato: string };

      expect(result.risultato).toBe("relazione_gia_validata");

      // Strength should remain 0.8
      const rel = await graphStore.getRelationship("maria", "marco", "mother");
      expect(rel!.strength).toBe(0.8);
    });

    it("registers custom type when unknown", async () => {
      await declare(
        { from: "luca", target: "paolo", type: "compagno_avventura", description: "Compagno di avventure" },
        makeCtx(1),
      );

      expect(plugin.typeRegistry.has("compagno_avventura")).toBe(true);
      const typeDef = plugin.typeRegistry.get("compagno_avventura")!;
      expect(typeDef.predefined).toBe(false);
      expect(typeDef.description).toBe("Compagno di avventure");
    });
  });

  describe("witness_relationship", () => {
    it("validates a mutual relationship with a witness", async () => {
      // Both declare
      await declare({ from: "maria", target: "marco", type: "friend" }, makeCtx(1));
      await declare({ from: "marco", target: "maria", type: "friend" }, makeCtx(2));

      // Third party witnesses
      const result = (await witness(
        { witness: "paolo", agent1: "maria", agent2: "marco", type: "friend" },
        makeCtx(3),
      )) as { risultato: string; stato: string };

      expect(result.risultato).toBe("relazione_validata");
      expect(result.stato).toBe("validated");

      const rel = await graphStore.getRelationship("maria", "marco", "friend");
      const meta = rel!.metadata as unknown as RelationshipMeta;
      expect(meta.status).toBe("validated");
      expect(meta.socialWitnesses).toContain("paolo");
      expect(rel!.strength).toBe(0.8);
    });

    it("registers witness without upgrading non-mutual relationships", async () => {
      // Only one side declared
      await declare({ from: "maria", target: "marco", type: "friend" }, makeCtx(1));

      const result = (await witness(
        { witness: "paolo", agent1: "maria", agent2: "marco", type: "friend" },
        makeCtx(2),
      )) as { risultato: string; stato: string };

      expect(result.risultato).toBe("testimonianza_registrata");

      const rel = await graphStore.getRelationship("maria", "marco", "friend");
      const meta = rel!.metadata as unknown as RelationshipMeta;
      expect(meta.status).toBe("proposed"); // still proposed
      expect(meta.socialWitnesses).toContain("paolo");
    });

    it("returns error when no relationship exists", async () => {
      const result = (await witness(
        { witness: "paolo", agent1: "maria", agent2: "marco", type: "friend" },
        makeCtx(1),
      )) as { risultato: string };

      expect(result.risultato).toBe("nessuna_relazione");
    });
  });

  describe("break_relationship", () => {
    it("breaks only the caller's direction", async () => {
      // Create mutual relationship
      await declare({ from: "maria", target: "marco", type: "friend" }, makeCtx(1));
      await declare({ from: "marco", target: "maria", type: "friend" }, makeCtx(2));

      // Maria breaks
      const result = (await breakRel(
        { from: "maria", target: "marco", type: "friend", reason: "tradimento" },
        makeCtx(3),
      )) as { risultato: string; stato: string };

      expect(result.risultato).toBe("relazione_interrotta");
      expect(result.stato).toBe("broken");

      // Maria→Marco should be broken
      const rel1 = await graphStore.getRelationship("maria", "marco", "friend");
      expect((rel1!.metadata as unknown as RelationshipMeta).status).toBe("broken");
      expect(rel1!.strength).toBe(0.1);

      // Marco→Maria should still be mutual (he doesn't know yet)
      const rel2 = await graphStore.getRelationship("marco", "maria", "friend");
      expect((rel2!.metadata as unknown as RelationshipMeta).status).toBe("mutual");
      expect(rel2!.strength).toBe(0.6);
    });

    it("returns error when no relationship exists to break", async () => {
      const result = (await breakRel(
        { from: "maria", target: "marco", type: "friend" },
        makeCtx(1),
      )) as { risultato: string };

      expect(result.risultato).toBe("nessuna_relazione");
    });
  });

  describe("check_relationship_status", () => {
    it("returns both directions of a relationship", async () => {
      await declare({ from: "maria", target: "marco", type: "friend" }, makeCtx(1));
      await declare({ from: "marco", target: "maria", type: "friend" }, makeCtx(2));

      const result = (await check(
        { agent1: "maria", agent2: "marco", type: "friend" },
        makeCtx(3),
      )) as { relazioni: Array<{ direzione: string; stato: string }> };

      expect(result.relazioni).toHaveLength(2);
      expect(result.relazioni[0].stato).toBe("mutual");
      expect(result.relazioni[1].stato).toBe("mutual");
    });

    it("returns all relationship types when type is omitted", async () => {
      await declare({ from: "maria", target: "marco", type: "friend" }, makeCtx(1));
      await declare({ from: "maria", target: "marco", type: "mentor" }, makeCtx(1));

      const result = (await check(
        { agent1: "maria", agent2: "marco" },
        makeCtx(2),
      )) as { relazioni: Array<{ tipo: string }> };

      expect(result.relazioni).toHaveLength(2);
      const types = result.relazioni.map((r) => r.tipo);
      expect(types).toContain("friend");
      expect(types).toContain("mentor");
    });

    it("returns no-relationship message when empty", async () => {
      const result = (await check(
        { agent1: "maria", agent2: "marco" },
        makeCtx(1),
      )) as { risultato: string };

      expect(result.risultato).toBe("nessuna_relazione");
    });
  });

  describe("seedRelationships", () => {
    it("creates validated relationships at strength 0.8", async () => {
      await plugin.seedRelationships(
        [
          { from: "maria", to: "marco", type: "mother" },
          { from: "marco", to: "maria", type: "child" },
        ],
        graphStore,
      );

      const rel = await graphStore.getRelationship("maria", "marco", "mother");
      expect(rel).not.toBeNull();
      expect(rel!.strength).toBe(0.8);
      const meta = rel!.metadata as unknown as RelationshipMeta;
      expect(meta.status).toBe("validated");
      expect(meta.declaredBy).toEqual(["maria", "marco"]);

      const reverse = await graphStore.getRelationship("marco", "maria", "child");
      expect(reverse).not.toBeNull();
      expect(reverse!.strength).toBe(0.8);
    });
  });

  describe("type registry", () => {
    it("includes all default predefined types", () => {
      expect(plugin.typeRegistry.has("father")).toBe(true);
      expect(plugin.typeRegistry.has("mother")).toBe(true);
      expect(plugin.typeRegistry.has("friend")).toBe(true);
      expect(plugin.typeRegistry.has("partner")).toBe(true);
      expect(plugin.typeRegistry.has("rival")).toBe(true);
      expect(plugin.typeRegistry.get("father")!.predefined).toBe(true);
    });

    it("merges custom types from options", () => {
      const custom = new RelationshipPlugin({
        graphStore,
        customTypes: [
          { id: "padrino", title: "Padrino", description: "Padrino di battesimo", predefined: true },
        ],
      });

      expect(custom.typeRegistry.has("padrino")).toBe(true);
      expect(custom.typeRegistry.has("friend")).toBe(true); // defaults still present
    });
  });

  describe("full lifecycle: proposed → mutual → validated", () => {
    it("completes the full validation flow", async () => {
      // Step 1: Luca says he's Francesco's father
      const r1 = (await declare(
        { from: "luca", target: "francesco", type: "father" },
        makeCtx(1),
      )) as { stato: string };
      expect(r1.stato).toBe("proposed");

      // Step 2: Francesco confirms Luca is his father
      const r2 = (await declare(
        { from: "francesco", target: "luca", type: "father" },
        makeCtx(2),
      )) as { stato: string };
      expect(r2.stato).toBe("mutual");

      // Step 3: Paolo witnesses the relationship
      const r3 = (await witness(
        { witness: "paolo", agent1: "luca", agent2: "francesco", type: "father" },
        makeCtx(3),
      )) as { stato: string };
      expect(r3.stato).toBe("validated");

      // Verify final state
      const rel = await graphStore.getRelationship("luca", "francesco", "father");
      expect(rel!.strength).toBe(0.8);
      const meta = rel!.metadata as unknown as RelationshipMeta;
      expect(meta.status).toBe("validated");
      expect(meta.socialWitnesses).toContain("paolo");
      expect(meta.validatedAt).toBe(3);
    });
  });
});
