/**
 * Movement Plugin — Quick Demo
 *
 * Tests the MovementPlugin tools without needing an LLM.
 * Verifies: move, find nearby, GPS push, move toward agent, move to home.
 *
 * Usage:
 *   npx tsx examples/movement-demo/index.ts
 */
import { LocationIndex } from "../../src/location/LocationIndex.js";
import { MovementPlugin } from "../../src/plugins/built-in/MovementPlugin.js";
import type { WorldContext } from "../../src/types/WorldTypes.js";
import type { AgentTool } from "../../src/types/PluginTypes.js";

// ── Setup ────────────────────────────────────────────────────────────
const locationIndex = new LocationIndex();
const movement = new MovementPlugin(locationIndex, {
  defaultNearbyRadiusKm: 10,
});

// Register two agents with initial positions (Firenze area)
locationIndex.update("alice", { latitude: 43.7696, longitude: 11.2558, label: "Piazza del Duomo" });
locationIndex.update("bob", { latitude: 43.7687, longitude: 11.2569, label: "Piazza della Signoria" });

// Register home locations
movement.registerHome("alice", { latitude: 43.78, longitude: 11.24, label: "Casa di Alice" });
movement.registerHome("bob", { latitude: 43.76, longitude: 11.26, label: "Casa di Bob" });

// Helper: create a fake WorldContext for a given agent
function makeCtx(agentId: string, tick = 1): WorldContext {
  return {
    worldId: "demo",
    tickCount: tick,
    startedAt: new Date(),
    metadata: { currentAgentId: agentId },
  };
}

// Helper: find a tool by name
function tool(name: string): AgentTool {
  const t = movement.tools.find((t) => t.name === name);
  if (!t) throw new Error(`Tool "${name}" not found`);
  return t;
}

// ── Run tests ────────────────────────────────────────────────────────
async function run() {
  console.log("=== MovementPlugin Demo ===\n");

  // 1. get_my_location
  console.log("1. Alice checks her location:");
  const loc = await tool("get_my_location").execute({}, makeCtx("alice"));
  console.log("  ", JSON.stringify(loc));

  // 2. find_nearby_agents
  console.log("\n2. Alice looks for nearby agents (10km):");
  const nearby = await tool("find_nearby_agents").execute({ radiusKm: 10 }, makeCtx("alice"));
  console.log("  ", JSON.stringify(nearby));

  // 3. move_to_coordinates
  console.log("\n3. Alice moves to Ponte Vecchio:");
  const moved = await tool("move_to_coordinates").execute(
    { latitude: 43.7680, longitude: 11.2531, label: "Ponte Vecchio" },
    makeCtx("alice"),
  );
  console.log("  ", JSON.stringify(moved));

  // 4. move_toward_agent
  console.log("\n4. Alice moves toward Bob:");
  const toward = await tool("move_toward_agent").execute(
    { targetAgentId: "bob", stopDistanceKm: 0.05 },
    makeCtx("alice"),
  );
  console.log("  ", JSON.stringify(toward));

  // 5. find_nearby_agents after moving
  console.log("\n5. Alice checks who's nearby now:");
  const nearby2 = await tool("find_nearby_agents").execute({ radiusKm: 1 }, makeCtx("alice"));
  console.log("  ", JSON.stringify(nearby2));

  // 6. move_to_home
  console.log("\n6. Alice goes home:");
  const home = await tool("move_to_home").execute({}, makeCtx("alice"));
  console.log("  ", JSON.stringify(home));

  // 7. External GPS push (simulating a real phone)
  console.log("\n7. External GPS push — Bob's phone sends coordinates:");
  movement.updateRealPosition("bob", 43.7700, 11.2490, "Stazione SMN");
  const bobLoc = await tool("get_my_location").execute({}, makeCtx("bob"));
  console.log("  ", JSON.stringify(bobLoc));

  // 8. Movement history
  console.log("\n8. Alice's movement history:");
  const history = movement.getMovementHistory("alice");
  for (const h of history) {
    console.log(`   tick ${h.tick} | ${h.source} | ${h.from?.label ?? "?"} → ${h.to.label ?? `${h.to.latitude.toFixed(4)},${h.to.longitude.toFixed(4)}`}`);
  }

  console.log("\n9. Bob's movement history:");
  const bobHistory = movement.getMovementHistory("bob");
  for (const h of bobHistory) {
    console.log(`   tick ${h.tick} | ${h.source} | ${h.from?.label ?? "?"} → ${h.to.label ?? "?"}`);
  }

  // 10. onWorldTick — process pending external updates
  console.log("\n10. Processing pending external updates via onWorldTick:");
  console.log(`   Pending before: ${movement.getPendingExternalUpdates().length}`);
  await movement.onWorldTick!(2, makeCtx("", 2));
  console.log(`   Pending after: ${movement.getPendingExternalUpdates().length}`);

  console.log("\n=== Demo complete! ===");
}

run().catch(console.error);
