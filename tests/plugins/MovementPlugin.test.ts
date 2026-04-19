import { describe, it, expect, beforeEach } from "vitest";
import { MovementPlugin } from "../../src/plugins/built-in/MovementPlugin.js";
import { LocationIndex } from "../../src/location/LocationIndex.js";
import { InMemoryAssetStore } from "../../src/stores/InMemoryAssetStore.js";
import type { AgentTool } from "../../src/types/PluginTypes.js";
import type { WorldContext } from "../../src/types/WorldTypes.js";
import type { Asset } from "../../src/types/AssetTypes.js";
import type { MovementPolicy } from "../../src/plugins/built-in/movement/MovementPolicy.js";

function makeCtx(agentId: string, tick = 1): WorldContext {
  return {
    worldId: "test",
    tickCount: tick,
    startedAt: new Date(),
    metadata: { currentAgentId: agentId },
  };
}

function findTool(tools: AgentTool[], name: string): AgentTool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool '${name}' not found`);
  return t;
}

function makeVehicle(owner: string, id = "car-1"): Asset {
  return {
    id,
    type: "vehicle",
    name: "Fiat Panda",
    owner,
    ownerType: "agent",
  };
}

describe("MovementPlugin with movement policy", () => {
  let locationIndex: LocationIndex;
  let assetStore: InMemoryAssetStore;

  beforeEach(() => {
    locationIndex = new LocationIndex();
    assetStore = new InMemoryAssetStore();
  });

  it("allows walking within the configured radius (default policy)", async () => {
    locationIndex.update("alice", { latitude: 45.0, longitude: 9.0 });
    const plugin = new MovementPlugin(locationIndex, {
      walkingRadiusMeters: 1500,
      assetStore,
    });
    const move = findTool(plugin.tools, "move_to_coordinates");

    // Approximately 200 meters away (lat-only delta of ~0.0018 degrees).
    const result = (await move.execute(
      { latitude: 45.0018, longitude: 9.0 },
      makeCtx("alice"),
    )) as { spostato?: boolean; modalità?: string; errore?: string };

    expect(result.errore).toBeUndefined();
    expect(result.spostato).toBe(true);
    expect(result.modalità).toBe("walking");
  });

  it("requires a vehicle beyond the walking radius", async () => {
    locationIndex.update("alice", { latitude: 45.0, longitude: 9.0 });
    const plugin = new MovementPlugin(locationIndex, {
      walkingRadiusMeters: 500,
      assetStore,
    });
    const move = findTool(plugin.tools, "move_to_coordinates");

    const resDenied = (await move.execute(
      { latitude: 45.1, longitude: 9.0 }, // ~11 km away
      makeCtx("alice"),
    )) as { errore?: string };
    expect(resDenied.errore).toBeDefined();
    expect(resDenied.errore).toMatch(/veicolo|lunga/i);

    // Now give Alice a car and retry
    await assetStore.addAsset(makeVehicle("alice"));
    const resAllowed = (await move.execute(
      { latitude: 45.1, longitude: 9.0 },
      makeCtx("alice"),
    )) as { spostato?: boolean; modalità?: string };
    expect(resAllowed.spostato).toBe(true);
    expect(resAllowed.modalità).toBe("driving");
  });

  it("respects a custom MovementPolicy", async () => {
    locationIndex.update("alice", { latitude: 45.0, longitude: 9.0 });
    const calls: string[] = [];
    const customPolicy: MovementPolicy = (req) => {
      calls.push(req.agentId);
      return { allowed: false, reason: "piove troppo" };
    };
    const plugin = new MovementPlugin(locationIndex, {
      policy: customPolicy,
      assetStore,
    });
    const move = findTool(plugin.tools, "move_to_coordinates");

    const res = (await move.execute(
      { latitude: 45.001, longitude: 9.0 },
      makeCtx("alice"),
    )) as { errore?: string };

    expect(res.errore).toBe("piove troppo");
    expect(calls).toEqual(["alice"]);
  });

  it("allows the first placement (from is null)", async () => {
    // No prior location for Alice
    const plugin = new MovementPlugin(locationIndex, { assetStore });
    const move = findTool(plugin.tools, "move_to_coordinates");

    const result = (await move.execute(
      { latitude: 10, longitude: 20 },
      makeCtx("alice"),
    )) as { spostato?: boolean; errore?: string };

    expect(result.errore).toBeUndefined();
    expect(result.spostato).toBe(true);
  });

  it("setPolicy swaps the active policy at runtime", async () => {
    locationIndex.update("alice", { latitude: 45.0, longitude: 9.0 });
    const plugin = new MovementPlugin(locationIndex, {
      walkingRadiusMeters: 100_000, // permissive default
      assetStore,
    });
    plugin.setPolicy(() => ({ allowed: false, reason: "blocked" }));

    const move = findTool(plugin.tools, "move_to_coordinates");
    const res = (await move.execute(
      { latitude: 45.001, longitude: 9.0 },
      makeCtx("alice"),
    )) as { errore?: string };
    expect(res.errore).toBe("blocked");
  });
});
