import { describe, expect, it } from "vitest";
import {
  crossWorldEnvelopeSchema,
  travelEdgeSchema,
  worldNodeSchema,
} from "../../src/federation/schemas.js";

describe("federation Zod schemas", () => {
  describe("worldNodeSchema", () => {
    it("accepts a minimal valid node", () => {
      const node = worldNodeSchema.parse({
        worldId: "firenze",
        displayName: "Firenze",
        capabilities: ["messaging"],
      });
      expect(node.worldId).toBe("firenze");
    });

    it("accepts coordinates and endpoint", () => {
      const node = worldNodeSchema.parse({
        worldId: "roma",
        displayName: "Roma",
        capabilities: ["messaging", "calls", "travel"],
        coordinates: { lat: 41.9, lng: 12.5 },
        endpoint: "redis://rome.local:6379",
      });
      expect(node.coordinates?.lat).toBeCloseTo(41.9);
    });

    it("rejects invalid capability values", () => {
      expect(() =>
        worldNodeSchema.parse({
          worldId: "r",
          displayName: "R",
          capabilities: ["teleport"],
        }),
      ).toThrow();
    });
  });

  describe("crossWorldEnvelopeSchema", () => {
    const base = {
      id: "env-1",
      fromWorldId: "firenze",
      toWorldId: "roma",
      fromAgentId: "maria",
      toAgentId: "luca",
      channel: "sms" as const,
      payload: { body: "ciao" },
      sentAtTick: 5,
      sentAtRealTime: "2026-04-24T12:00:00.000Z",
    };

    it("accepts a well-formed envelope", () => {
      expect(() => crossWorldEnvelopeSchema.parse(base)).not.toThrow();
    });

    it("accepts an optional correlationId", () => {
      const env = crossWorldEnvelopeSchema.parse({
        ...base,
        correlationId: "call-42",
      });
      expect(env.correlationId).toBe("call-42");
    });

    it("rejects negative ticks", () => {
      expect(() =>
        crossWorldEnvelopeSchema.parse({ ...base, sentAtTick: -1 }),
      ).toThrow();
    });

    it("rejects unknown channels", () => {
      expect(() =>
        crossWorldEnvelopeSchema.parse({ ...base, channel: "telegram" }),
      ).toThrow();
    });
  });

  describe("travelEdgeSchema", () => {
    it("requires at least one mode", () => {
      expect(() =>
        travelEdgeSchema.parse({
          fromWorldId: "firenze",
          toWorldId: "roma",
          modes: [],
        }),
      ).toThrow();
    });

    it("supports estimatedTicks = 0 for adjacency", () => {
      const edge = travelEdgeSchema.parse({
        fromWorldId: "hr",
        toWorldId: "tech",
        modes: [{ kind: "walk", estimatedTicks: 0, energyCost: 0 }],
      });
      expect(edge.modes[0]?.estimatedTicks).toBe(0);
    });
  });
});
