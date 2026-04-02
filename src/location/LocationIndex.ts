import type { GeoLocation } from "../types/LocationTypes.js";

export interface NearbyResult {
  agentId: string;
  distance: number;
}

/**
 * Spatial index for agent locations.
 * Uses Haversine formula for distance calculation.
 */
export class LocationIndex {
  private locations: Map<string, GeoLocation> = new Map();

  update(agentId: string, location: GeoLocation): void {
    this.locations.set(agentId, location);
  }

  remove(agentId: string): void {
    this.locations.delete(agentId);
  }

  getLocation(agentId: string): GeoLocation | undefined {
    return this.locations.get(agentId);
  }

  /**
   * Finds agents within the given radius (km) of the specified agent.
   * Returns results sorted by distance ascending.
   */
  findNearby(agentId: string, radiusKm: number): NearbyResult[] {
    const origin = this.locations.get(agentId);
    if (!origin) return [];

    const results: NearbyResult[] = [];

    for (const [id, loc] of this.locations) {
      if (id === agentId) continue;
      const dist = haversineDistance(origin, loc);
      if (dist <= radiusKm) {
        results.push({ agentId: id, distance: dist });
      }
    }

    return results.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Finds agents within the given radius of an arbitrary point.
   */
  findNearbyPoint(point: GeoLocation, radiusKm: number): NearbyResult[] {
    const results: NearbyResult[] = [];

    for (const [id, loc] of this.locations) {
      const dist = haversineDistance(point, loc);
      if (dist <= radiusKm) {
        results.push({ agentId: id, distance: dist });
      }
    }

    return results.sort((a, b) => a.distance - b.distance);
  }

  get size(): number {
    return this.locations.size;
  }

  clear(): void {
    this.locations.clear();
  }
}

/**
 * Calculates the distance in kilometers between two geographic points
 * using the Haversine formula.
 * TODO: maybe we need to refactor this using leaflet or library with map and evaluation correct real radius
 */
function haversineDistance(a: GeoLocation, b: GeoLocation): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
