/** Asset type categories. */
export type AssetType = "property" | "vehicle" | "resource" | "item" | "venue" | "infrastructure";

/** Venue sub-type for places agents can visit. */
export type VenueType =
  | "bar"
  | "restaurant"
  | "office"
  | "shop"
  | "gym"
  | "park"
  | "church"
  | "school"
  | "home"
  | "event_space"
  | "other";

/** A physical location. */
export interface AssetLocation {
  lat?: number | undefined;
  lng?: number | undefined;
  address?: string | undefined;
}

/** A tangible or intangible asset owned by an agent, household, or community. */
export interface Asset {
  id: string;
  type: AssetType;
  name: string;
  description?: string | undefined;
  owner: string;
  ownerType: "agent" | "household" | "community";
  quantity?: number | undefined;
  value?: number | undefined;
  condition?: number | undefined;
  location?: AssetLocation | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/** A visitable place — extends Asset with venue-specific fields. */
export interface Venue extends Asset {
  type: "venue";
  venueType: VenueType;
  capacity?: number | undefined;
  openHours?: string | undefined;
  currentVisitors?: string[] | undefined;
}

/** A family unit that shares assets and a home. */
export interface Household {
  id: string;
  name: string;
  members: string[];
  headOfHousehold?: string | undefined;
  sharedAssets?: string[] | undefined;
}

/** Store interface for managing assets, venues, and households. */
export interface AssetStore {
  // ── CRUD ────────────────────────────────────────────────────────
  addAsset(asset: Asset): Promise<void>;
  addAssets(assets: Asset[]): Promise<void>;
  getAsset(id: string): Promise<Asset | undefined>;
  updateAsset(id: string, updates: Partial<Omit<Asset, "id">>): Promise<void>;
  removeAsset(id: string): Promise<void>;

  // ── Query ───────────────────────────────────────────────────────
  getAgentAssets(agentId: string): Promise<Asset[]>;
  getHouseholdAssets(householdId: string): Promise<Asset[]>;
  getCommunityAssets(): Promise<Asset[]>;
  getAssetsByType(type: AssetType): Promise<Asset[]>;
  getVenues(filter?: { venueType?: VenueType }): Promise<Venue[]>;
  getVenueVisitors(venueId: string): Promise<string[]>;

  // ── Actions ─────────────────────────────────────────────────────
  transferAsset(assetId: string, toOwner: string, toOwnerType: Asset["ownerType"]): Promise<void>;
  consumeResource(assetId: string, amount: number): Promise<{ remaining: number }>;
  enterVenue(venueId: string, agentId: string): Promise<void>;
  leaveVenue(venueId: string, agentId: string): Promise<void>;
  leaveAllVenues(agentId: string): Promise<void>;

  // ── Household ───────────────────────────────────────────────────
  addHousehold(household: Household): Promise<void>;
  getHousehold(id: string): Promise<Household | undefined>;
  getAgentHousehold(agentId: string): Promise<Household | undefined>;
  getAllHouseholds(): Promise<Household[]>;

  // ── Utility ─────────────────────────────────────────────────────
  getAgentCurrentVenue(agentId: string): Promise<Venue | undefined>;
}
