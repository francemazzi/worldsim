import type { Asset, AssetStore, AssetType, Household, Venue, VenueType } from "../types/AssetTypes.js";

export class InMemoryAssetStore implements AssetStore {
  private assets = new Map<string, Asset>();
  private households = new Map<string, Household>();
  // Index: agentId → Set of venue IDs where the agent currently is
  private agentVenues = new Map<string, Set<string>>();

  // ── CRUD ────────────────────────────────────────────────────────

  async addAsset(asset: Asset): Promise<void> {
    this.assets.set(asset.id, { ...asset });
  }

  async addAssets(assets: Asset[]): Promise<void> {
    for (const asset of assets) {
      this.assets.set(asset.id, { ...asset });
    }
  }

  async getAsset(id: string): Promise<Asset | undefined> {
    const a = this.assets.get(id);
    return a ? { ...a } : undefined;
  }

  async updateAsset(id: string, updates: Partial<Omit<Asset, "id">>): Promise<void> {
    const existing = this.assets.get(id);
    if (!existing) return;
    this.assets.set(id, { ...existing, ...updates, id });
  }

  async removeAsset(id: string): Promise<void> {
    this.assets.delete(id);
  }

  // ── Query ───────────────────────────────────────────────────────

  async getAgentAssets(agentId: string): Promise<Asset[]> {
    const result: Asset[] = [];
    for (const a of this.assets.values()) {
      if (a.owner === agentId && a.ownerType === "agent") {
        result.push({ ...a });
      }
    }
    return result;
  }

  async getHouseholdAssets(householdId: string): Promise<Asset[]> {
    const result: Asset[] = [];
    for (const a of this.assets.values()) {
      if (a.owner === householdId && a.ownerType === "household") {
        result.push({ ...a });
      }
    }
    return result;
  }

  async getCommunityAssets(): Promise<Asset[]> {
    const result: Asset[] = [];
    for (const a of this.assets.values()) {
      if (a.ownerType === "community") {
        result.push({ ...a });
      }
    }
    return result;
  }

  async getAssetsByType(type: AssetType): Promise<Asset[]> {
    const result: Asset[] = [];
    for (const a of this.assets.values()) {
      if (a.type === type) result.push({ ...a });
    }
    return result;
  }

  async getVenues(filter?: { venueType?: VenueType }): Promise<Venue[]> {
    const result: Venue[] = [];
    for (const a of this.assets.values()) {
      if (a.type === "venue") {
        const venue = a as Venue;
        if (!filter?.venueType || venue.venueType === filter.venueType) {
          result.push({ ...venue });
        }
      }
    }
    return result;
  }

  async getVenueVisitors(venueId: string): Promise<string[]> {
    const venue = this.assets.get(venueId);
    if (!venue || venue.type !== "venue") return [];
    return [...((venue as Venue).currentVisitors ?? [])];
  }

  // ── Actions ─────────────────────────────────────────────────────

  async transferAsset(assetId: string, toOwner: string, toOwnerType: Asset["ownerType"]): Promise<void> {
    const asset = this.assets.get(assetId);
    if (!asset) return;
    asset.owner = toOwner;
    asset.ownerType = toOwnerType;
  }

  async consumeResource(assetId: string, amount: number): Promise<{ remaining: number }> {
    const asset = this.assets.get(assetId);
    if (!asset || asset.quantity == null) return { remaining: 0 };
    asset.quantity = Math.max(0, asset.quantity - amount);
    return { remaining: asset.quantity };
  }

  async enterVenue(venueId: string, agentId: string): Promise<void> {
    const asset = this.assets.get(venueId);
    if (!asset || asset.type !== "venue") return;
    const venue = asset as Venue;
    if (!venue.currentVisitors) venue.currentVisitors = [];
    if (!venue.currentVisitors.includes(agentId)) {
      venue.currentVisitors.push(agentId);
    }
    // Track in index
    let agentSet = this.agentVenues.get(agentId);
    if (!agentSet) {
      agentSet = new Set();
      this.agentVenues.set(agentId, agentSet);
    }
    agentSet.add(venueId);
  }

  async leaveVenue(venueId: string, agentId: string): Promise<void> {
    const asset = this.assets.get(venueId);
    if (!asset || asset.type !== "venue") return;
    const venue = asset as Venue;
    if (venue.currentVisitors) {
      venue.currentVisitors = venue.currentVisitors.filter((id) => id !== agentId);
    }
    this.agentVenues.get(agentId)?.delete(venueId);
  }

  async leaveAllVenues(agentId: string): Promise<void> {
    const venues = this.agentVenues.get(agentId);
    if (!venues) return;
    for (const venueId of venues) {
      const asset = this.assets.get(venueId);
      if (asset && asset.type === "venue") {
        const venue = asset as Venue;
        if (venue.currentVisitors) {
          venue.currentVisitors = venue.currentVisitors.filter((id) => id !== agentId);
        }
      }
    }
    venues.clear();
  }

  // ── Household ───────────────────────────────────────────────────

  async addHousehold(household: Household): Promise<void> {
    this.households.set(household.id, { ...household });
  }

  async getHousehold(id: string): Promise<Household | undefined> {
    const h = this.households.get(id);
    return h ? { ...h } : undefined;
  }

  async getAgentHousehold(agentId: string): Promise<Household | undefined> {
    for (const h of this.households.values()) {
      if (h.members.includes(agentId)) return { ...h };
    }
    return undefined;
  }

  async getAllHouseholds(): Promise<Household[]> {
    return [...this.households.values()].map((h) => ({ ...h }));
  }

  // ── Utility ─────────────────────────────────────────────────────

  async getAgentCurrentVenue(agentId: string): Promise<Venue | undefined> {
    const venues = this.agentVenues.get(agentId);
    if (!venues || venues.size === 0) return undefined;
    // Return first venue (agent typically in one place)
    const venueId = [...venues][0];
    if (!venueId) return undefined;
    const asset = this.assets.get(venueId);
    if (!asset || asset.type !== "venue") return undefined;
    return { ...(asset as Venue) };
  }
}
