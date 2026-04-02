import type { GeoLocation } from "../types/LocationTypes.js";

export interface NearbyResult {
  agentId: string;
  distance: number;
}

/**
 * Approximate km per degree of latitude (constant).
 * Longitude varies by cos(lat), handled in cellKey.
 */
const KM_PER_DEG_LAT = 111.32;

/**
 * Spatial index for agent locations.
 * Uses a grid-based spatial hash for O(k) nearby lookups (k = agents in nearby cells)
 * and falls back to Haversine for accurate distance filtering.
 */
export class LocationIndex {
  private locations: Map<string, GeoLocation> = new Map();
  /** Maps agentId → current grid cell key */
  private agentCells: Map<string, string> = new Map();
  /** Maps cell key → set of agent IDs in that cell */
  private grid: Map<string, Set<string>> = new Map();
  /** Grid cell size in km. Smaller = fewer candidates but more cells. */
  private cellSizeKm: number;

  constructor(cellSizeKm = 10) {
    this.cellSizeKm = cellSizeKm;
  }

  update(agentId: string, location: GeoLocation): void {
    // Remove from old cell if moved
    const oldCell = this.agentCells.get(agentId);
    const newCell = this.cellKey(location);

    if (oldCell && oldCell !== newCell) {
      const oldSet = this.grid.get(oldCell);
      if (oldSet) {
        oldSet.delete(agentId);
        if (oldSet.size === 0) this.grid.delete(oldCell);
      }
    }

    this.locations.set(agentId, location);
    this.agentCells.set(agentId, newCell);

    let cellSet = this.grid.get(newCell);
    if (!cellSet) {
      cellSet = new Set();
      this.grid.set(newCell, cellSet);
    }
    cellSet.add(agentId);
  }

  remove(agentId: string): void {
    const cell = this.agentCells.get(agentId);
    if (cell) {
      const cellSet = this.grid.get(cell);
      if (cellSet) {
        cellSet.delete(agentId);
        if (cellSet.size === 0) this.grid.delete(cell);
      }
      this.agentCells.delete(agentId);
    }
    this.locations.delete(agentId);
  }

  getLocation(agentId: string): GeoLocation | undefined {
    return this.locations.get(agentId);
  }

  /**
   * Finds agents within the given radius (km) of the specified agent.
   * Uses grid to narrow candidates, then Haversine for exact filtering.
   * Returns results sorted by distance ascending.
   */
  findNearby(agentId: string, radiusKm: number): NearbyResult[] {
    const origin = this.locations.get(agentId);
    if (!origin) return [];
    return this.findNearbyFromPoint(origin, radiusKm, agentId);
  }

  /**
   * Finds agents within the given radius of an arbitrary point.
   */
  findNearbyPoint(point: GeoLocation, radiusKm: number): NearbyResult[] {
    return this.findNearbyFromPoint(point, radiusKm);
  }

  get size(): number {
    return this.locations.size;
  }

  clear(): void {
    this.locations.clear();
    this.agentCells.clear();
    this.grid.clear();
  }

  private findNearbyFromPoint(
    origin: GeoLocation,
    radiusKm: number,
    excludeId?: string,
  ): NearbyResult[] {
    const candidates = this.getCandidateCells(origin, radiusKm);
    const results: NearbyResult[] = [];

    for (const cellKey of candidates) {
      const cellAgents = this.grid.get(cellKey);
      if (!cellAgents) continue;

      for (const id of cellAgents) {
        if (id === excludeId) continue;
        const loc = this.locations.get(id)!;
        const dist = haversineDistance(origin, loc);
        if (dist <= radiusKm) {
          results.push({ agentId: id, distance: dist });
        }
      }
    }

    return results.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Converts a location to a grid cell key.
   * Cell size adapts to longitude compression at higher latitudes.
   */
  private cellKey(loc: GeoLocation): string {
    const latCell = Math.floor((loc.latitude * KM_PER_DEG_LAT) / this.cellSizeKm);
    const lonScale = KM_PER_DEG_LAT * Math.cos(toRad(loc.latitude));
    const lonCell = Math.floor((loc.longitude * lonScale) / this.cellSizeKm);
    return `${latCell}:${lonCell}`;
  }

  /**
   * Returns all grid cell keys that could contain agents within radiusKm of origin.
   */
  private getCandidateCells(origin: GeoLocation, radiusKm: number): string[] {
    const cellsInRadius = Math.ceil(radiusKm / this.cellSizeKm);
    const centerLatCell = Math.floor((origin.latitude * KM_PER_DEG_LAT) / this.cellSizeKm);
    const lonScale = KM_PER_DEG_LAT * Math.cos(toRad(origin.latitude));
    const centerLonCell = Math.floor((origin.longitude * lonScale) / this.cellSizeKm);

    const keys: string[] = [];
    for (let dLat = -cellsInRadius; dLat <= cellsInRadius; dLat++) {
      for (let dLon = -cellsInRadius; dLon <= cellsInRadius; dLon++) {
        keys.push(`${centerLatCell + dLat}:${centerLonCell + dLon}`);
      }
    }
    return keys;
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
