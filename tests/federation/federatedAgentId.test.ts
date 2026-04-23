import { describe, expect, it } from "vitest";
import {
  format,
  parse,
  isFederatedAgentId,
  isExternal,
  stripLocalPrefix,
} from "../../src/federation/FederatedAgentId.js";

describe("FederatedAgentId helpers", () => {
  describe("format", () => {
    it("joins worldId and agentId with a colon", () => {
      expect(format("firenze", "maria")).toBe("firenze:maria");
    });

    it("throws on empty components", () => {
      expect(() => format("", "maria")).toThrow();
      expect(() => format("firenze", "")).toThrow();
    });

    it("throws when worldId contains the separator", () => {
      expect(() => format("a:b", "agent")).toThrow();
    });
  });

  describe("parse", () => {
    it("splits a valid federated id", () => {
      expect(parse("roma:luca")).toEqual({ worldId: "roma", agentId: "luca" });
    });

    it("supports agent ids that contain colons", () => {
      expect(parse("roma:user:42")).toEqual({
        worldId: "roma",
        agentId: "user:42",
      });
    });

    it("returns null for malformed ids", () => {
      expect(parse("no-colon-here")).toBeNull();
      expect(parse(":missing-world")).toBeNull();
      expect(parse("missing-agent:")).toBeNull();
      expect(parse("")).toBeNull();
    });
  });

  describe("isFederatedAgentId", () => {
    it("narrows plain strings", () => {
      expect(isFederatedAgentId("firenze:maria")).toBe(true);
      expect(isFederatedAgentId("just-a-name")).toBe(false);
    });
  });

  describe("isExternal", () => {
    it("flags ids whose world differs from the local one", () => {
      expect(isExternal("roma:luca", "firenze")).toBe(true);
    });

    it("returns false for local federated ids and bare ids", () => {
      expect(isExternal("firenze:maria", "firenze")).toBe(false);
      expect(isExternal("maria", "firenze")).toBe(false);
    });
  });

  describe("stripLocalPrefix", () => {
    it("strips the local world prefix", () => {
      expect(stripLocalPrefix("firenze:maria", "firenze")).toBe("maria");
    });

    it("leaves external federated ids untouched", () => {
      expect(stripLocalPrefix("roma:luca", "firenze")).toBe("roma:luca");
    });

    it("leaves bare ids untouched", () => {
      expect(stripLocalPrefix("maria", "firenze")).toBe("maria");
    });
  });
});
