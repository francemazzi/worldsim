/**
 * Example: WorldSim with real-time Socket.IO streaming.
 *
 * Run:
 *   npx tsx examples/streaming-server/index.ts
 *
 * Then connect from a browser or socket.io-client:
 *   const socket = io("http://localhost:3000");
 *   socket.on("agent:action", (data) => console.log(data));
 *   socket.emit("subscribe:agent", "person-0"); // subscribe to a specific agent
 */

import { WorldSimServer } from "worldsim";

const server = new WorldSimServer(
  {
    worldId: "streaming-demo",
    maxTicks: 50,
    tickIntervalMs: 1000,
    llm: {
      baseURL: "https://api.openai.com/v1",
      apiKey: process.env.OPENAI_API_KEY!,
      model: "gpt-4o-mini",
    },
  },
  {
    port: 3000,
    corsOrigin: "*",
  },
);

// Add a control agent
server.addAgent({
  id: "governance",
  role: "control",
  name: "Governance",
  systemPrompt: `Sei un agente di governance. Monitora le regole e usa il tool
    'control_agent' per sospendere agenti che le violano.`,
});

// Add person agents
const personalities = ["curiosa", "scettica", "entusiasta"];
for (let i = 0; i < 3; i++) {
  server.addAgent({
    id: `person-${i}`,
    role: "person",
    name: `Persona ${i}`,
    iterationsPerTick: 2,
    systemPrompt: `Sei una persona con personalità ${personalities[i]}.`,
    profile: {
      name: `Persona ${i}`,
      personality: [personalities[i]],
      goals: ["Esplorare il mondo", "Interagire con gli altri"],
    },
  });
}

server.on("tick", (tick: number) => {
  console.log(`[Tick ${tick}]`);
});

console.log("Starting WorldSim server on http://localhost:3000 ...");
console.log("Connect with socket.io-client to receive real-time agent streams.");
console.log("");
console.log("Events you can listen to:");
console.log("  world:tick       — tick number + active agent count");
console.log("  world:status     — running / paused / stopped");
console.log("  world:snapshot   — full state (sent on connect)");
console.log("  agent:action     — agent actions (speak, observe, interact, ...)");
console.log("  agent:status     — agent lifecycle (start, pause, resume, stop)");
console.log("");
console.log("Commands you can send:");
console.log('  subscribe:agent    — join agent room (e.g. "person-0")');
console.log('  unsubscribe:agent  — leave agent room');
console.log('  command:pause      — { agentId: "person-0", reason: "..." }');
console.log('  command:resume     — { agentId: "person-0" }');
console.log('  command:stop       — { agentId: "person-0" }');
console.log("  command:world:pause / command:world:resume / command:world:stop");
console.log("");

await server.start();

process.on("SIGINT", async () => {
  await server.close();
  console.log("Server closed.");
  process.exit(0);
});
