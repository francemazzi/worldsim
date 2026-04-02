import { describe, it, expect, beforeEach } from "vitest";
import { LocationIndex } from "../../src/location/LocationIndex.js";

describe("LocationIndex", () => {
  let index: LocationIndex;

  beforeEach(() => {
    index = new LocationIndex();
  });

  it("stores and retrieves locations", () => {
    index.update("a", { latitude: 45.0, longitude: 9.0 });
    const loc = index.getLocation("a");
    expect(loc).toEqual({ latitude: 45.0, longitude: 9.0 });
  });

  it("returns undefined for unknown agent", () => {
    expect(index.getLocation("unknown")).toBeUndefined();
  });

  it("removes locations", () => {
    index.update("a", { latitude: 45.0, longitude: 9.0 });
    index.remove("a");
    expect(index.getLocation("a")).toBeUndefined();
  });

  describe("findNearby", () => {
    it("returns empty for unknown agent", () => {
      expect(index.findNearby("unknown", 10)).toEqual([]);
    });

    it("finds agents within radius", () => {
      // Milan and nearby points
      index.update("milan", { latitude: 45.4642, longitude: 9.1900 });
      index.update("monza", { latitude: 45.5845, longitude: 9.2744 }); // ~15km
      index.update("rome", { latitude: 41.9028, longitude: 12.4964 }); // ~480km

      const nearby = index.findNearby("milan", 30);
      expect(nearby).toHaveLength(1);
      expect(nearby[0]!.agentId).toBe("monza");
      expect(nearby[0]!.distance).toBeGreaterThan(10);
      expect(nearby[0]!.distance).toBeLessThan(20);
    });

    it("returns results sorted by distance", () => {
      index.update("origin", { latitude: 0, longitude: 0 });
      index.update("far", { latitude: 2, longitude: 0 }); // ~222km
      index.update("near", { latitude: 0.5, longitude: 0 }); // ~55km
      index.update("mid", { latitude: 1, longitude: 0 }); // ~111km

      const results = index.findNearby("origin", 300);
      expect(results).toHaveLength(3);
      expect(results[0]!.agentId).toBe("near");
      expect(results[1]!.agentId).toBe("mid");
      expect(results[2]!.agentId).toBe("far");
    });

    it("excludes agents outside radius", () => {
      index.update("a", { latitude: 0, longitude: 0 });
      index.update("b", { latitude: 10, longitude: 0 }); // ~1111km

      const results = index.findNearby("a", 100);
      expect(results).toHaveLength(0);
    });
  });

  describe("findNearbyPoint", () => {
    it("finds agents near an arbitrary point", () => {
      index.update("a", { latitude: 45.0, longitude: 9.0 });
      index.update("b", { latitude: 46.0, longitude: 9.0 });

      const results = index.findNearbyPoint({ latitude: 45.1, longitude: 9.0 }, 20);
      expect(results).toHaveLength(1);
      expect(results[0]!.agentId).toBe("a");
    });
  });

  it("tracks size correctly", () => {
    expect(index.size).toBe(0);
    index.update("a", { latitude: 0, longitude: 0 });
    index.update("b", { latitude: 1, longitude: 1 });
    expect(index.size).toBe(2);
    index.remove("a");
    expect(index.size).toBe(1);
  });
});
