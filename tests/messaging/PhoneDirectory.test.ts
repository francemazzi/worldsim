import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryAssetStore } from "../../src/stores/InMemoryAssetStore.js";
import {
  PhoneDirectory,
  createPhoneAsset,
  getAgentPhone,
  getPhoneMetadata,
  isPhoneAsset,
} from "../../src/messaging/phone/PhoneDirectory.js";

describe("PhoneDirectory", () => {
  let store: InMemoryAssetStore;
  let directory: PhoneDirectory;

  beforeEach(async () => {
    store = new InMemoryAssetStore();
    directory = new PhoneDirectory(store);
    await store.addAssets([
      createPhoneAsset({ agentId: "alice", phoneNumber: "+39 111" }),
      createPhoneAsset({ agentId: "bob", phoneNumber: "+39 222" }),
    ]);
  });

  it("createPhoneAsset builds a phone-tagged item asset", () => {
    const phone = createPhoneAsset({ agentId: "alice", phoneNumber: "+39 111" });
    expect(phone.type).toBe("item");
    expect(phone.ownerType).toBe("agent");
    expect(phone.owner).toBe("alice");
    expect(isPhoneAsset(phone)).toBe(true);
    expect(getPhoneMetadata(phone)?.phoneNumber).toBe("+39 111");
  });

  it("resolve() maps a number to the owning agent id", async () => {
    expect(await directory.resolve("+39 111")).toBe("alice");
    expect(await directory.resolve("+39 222")).toBe("bob");
  });

  it("resolve() trims whitespace and returns null for unknown numbers", async () => {
    expect(await directory.resolve("  +39 111  ")).toBe("alice");
    expect(await directory.resolve("+39 999")).toBeNull();
    expect(await directory.resolve("")).toBeNull();
  });

  it("getNumber() returns the agent's phone number", async () => {
    expect(await directory.getNumber("alice")).toBe("+39 111");
    expect(await directory.getNumber("nobody")).toBeNull();
  });

  it("getAgentPhone() returns undefined when the agent has no phone", async () => {
    expect(await getAgentPhone(store, "nobody")).toBeUndefined();
  });

  it("isReachable() respects the `online` flag", async () => {
    expect(await directory.isReachable("alice")).toBe(true);
    await store.addAsset(
      createPhoneAsset({ agentId: "charlie", phoneNumber: "+39 333", online: false }),
    );
    expect(await directory.isReachable("charlie")).toBe(false);
  });

  it("is deterministic when an agent owns multiple phones", async () => {
    const fresh = new InMemoryAssetStore();
    await fresh.addAssets([
      createPhoneAsset({
        agentId: "dora",
        phoneNumber: "+39 444",
        assetId: "phone-dora-b",
      }),
      createPhoneAsset({
        agentId: "dora",
        phoneNumber: "+39 555",
        assetId: "phone-dora-a",
      }),
    ]);
    const phone = await getAgentPhone(fresh, "dora");
    expect(phone?.id).toBe("phone-dora-a");
  });
});
