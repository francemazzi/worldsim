import type { Asset, AssetStore } from "../../types/AssetTypes.js";

export const PHONE_ASSET_KIND = "phone";

export interface PhoneContact {
  name: string;
  phoneNumber: string;
}

export interface PhoneMetadata {
  kind: typeof PHONE_ASSET_KIND;
  phoneNumber: string;
  contacts?: PhoneContact[];
  online?: boolean;
}

export interface CreatePhoneAssetInput {
  agentId: string;
  phoneNumber: string;
  name?: string;
  contacts?: PhoneContact[];
  online?: boolean;
  assetId?: string;
}

/**
 * Creates an Asset representing a phone owned by an agent.
 * The phone is modelled as `type: "item"` with `metadata.kind: "phone"` plus
 * the phone number and optional contact list.
 */
export function createPhoneAsset(input: CreatePhoneAssetInput): Asset {
  const metadata: PhoneMetadata = {
    kind: PHONE_ASSET_KIND,
    phoneNumber: input.phoneNumber,
    ...(input.contacts ? { contacts: input.contacts } : {}),
    ...(input.online != null ? { online: input.online } : {}),
  };

  return {
    id: input.assetId ?? `phone-${input.agentId}-${input.phoneNumber}`,
    type: "item",
    name: input.name ?? `Telefono ${input.phoneNumber}`,
    owner: input.agentId,
    ownerType: "agent",
    metadata: metadata as unknown as Record<string, unknown>,
  };
}

/** Type guard: tells whether an asset is a phone (by convention). */
export function isPhoneAsset(asset: Asset): boolean {
  if (asset.type !== "item") return false;
  const meta = asset.metadata as Partial<PhoneMetadata> | undefined;
  return meta?.kind === PHONE_ASSET_KIND && typeof meta.phoneNumber === "string";
}

/** Reads phone-specific metadata from an asset. Returns undefined if not a phone. */
export function getPhoneMetadata(asset: Asset): PhoneMetadata | undefined {
  if (!isPhoneAsset(asset)) return undefined;
  return asset.metadata as unknown as PhoneMetadata;
}

/**
 * Returns the first phone asset owned by the agent, if any.
 * If the agent owns multiple phones, the one with the lowest id is returned
 * for deterministic behaviour.
 */
export async function getAgentPhone(
  assetStore: AssetStore,
  agentId: string,
): Promise<Asset | undefined> {
  const assets = await assetStore.getAgentAssets(agentId);
  const phones = assets.filter(isPhoneAsset);
  if (phones.length === 0) return undefined;
  phones.sort((a, b) => a.id.localeCompare(b.id));
  return phones[0];
}

/**
 * Resolves phone numbers to agent ids.
 *
 * Implementation is intentionally simple: every lookup scans all item-type
 * assets. This is O(n) in the number of items but keeps the class stateless
 * and always in-sync with the store, which is important because agents can
 * acquire or lose phones at runtime. For very large worlds, integrators can
 * swap this with a cached directory built once per tick.
 */
export class PhoneDirectory {
  constructor(private readonly assetStore: AssetStore) {}

  /** Returns the agent id owning the given phone number, or `null`. */
  async resolve(phoneNumber: string): Promise<string | null> {
    const normalized = phoneNumber.trim();
    if (normalized === "") return null;

    const items = await this.assetStore.getAssetsByType("item");
    for (const asset of items) {
      if (asset.ownerType !== "agent") continue;
      const meta = getPhoneMetadata(asset);
      if (!meta) continue;
      if (meta.phoneNumber === normalized) {
        return asset.owner;
      }
    }
    return null;
  }

  /** Returns the phone number of the given agent, or `null` if they have none. */
  async getNumber(agentId: string): Promise<string | null> {
    const phone = await getAgentPhone(this.assetStore, agentId);
    if (!phone) return null;
    return getPhoneMetadata(phone)?.phoneNumber ?? null;
  }

  /** Returns true if the agent owns a phone that is online (default: true when flag missing). */
  async isReachable(agentId: string): Promise<boolean> {
    const phone = await getAgentPhone(this.assetStore, agentId);
    if (!phone) return false;
    const meta = getPhoneMetadata(phone);
    if (!meta) return false;
    return meta.online !== false;
  }
}
