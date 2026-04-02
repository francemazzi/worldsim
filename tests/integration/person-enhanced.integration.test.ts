import { describe, it, expect, beforeEach } from "vitest";
import { config } from "dotenv";
import { WorldEngine } from "../../src/engine/WorldEngine.js";
import { InMemoryMemoryStore } from "../helpers/InMemoryMemoryStore.js";
import { InMemoryGraphStore } from "../helpers/InMemoryGraphStore.js";
import { join } from "node:path";
import type { AgentTool } from "../../src/types/PluginTypes.js";

config({ path: ".env" });

const apiKey = process.env["OPENAI_API_KEY"];
const rulesPath = join(
  import.meta.dirname,
  "..",
  "rules",
  "fixtures",
  "valid-rules.json",
);

function makeLLMConfig() {
  return {
    baseURL: "https://api.openai.com/v1",
    apiKey: apiKey!,
    model: "gpt-4o-mini",
    temperature: 0,
    maxTokens: 200,
  };
}

describe.skipIf(!apiKey)("PersonAgent enhanced E2E", () => {
  let memoryStore: InMemoryMemoryStore;
  let graphStore: InMemoryGraphStore;

  beforeEach(() => {
    memoryStore = new InMemoryMemoryStore();
    graphStore = new InMemoryGraphStore();
  });

  it("memory persists across ticks and grows", async () => {
    const engine = new WorldEngine({
      worldId: "memory-persist",
      maxTicks: 3,
      tickIntervalMs: 0,
      llm: makeLLMConfig(),
      rulesPath: { json: [rulesPath] },
      memoryStore,
    });

    engine.addAgent({
      id: "control-1",
      role: "control",
      name: "Governance",
      systemPrompt: "Sei un agente di governance.",
    });

    engine.addAgent({
      id: "person-a",
      role: "person",
      name: "Alice",
      profile: {
        name: "Alice",
        personality: ["curiosa"],
        goals: ["esplorare"],
      },
      initialState: { mood: "neutro", energy: 80 },
      iterationsPerTick: 1,
    });

    await engine.start();

    const memories = await memoryStore.getRecent("person-a", 100);
    expect(memories.length).toBeGreaterThanOrEqual(3);

    // Verify memories span multiple ticks
    const ticks = new Set(memories.map((m) => m.tick));
    expect(ticks.size).toBe(3);
  });

  it("relationships created after multi-agent interaction", async () => {
    const engine = new WorldEngine({
      worldId: "graph-test",
      maxTicks: 2,
      tickIntervalMs: 0,
      llm: makeLLMConfig(),
      rulesPath: { json: [rulesPath] },
      memoryStore,
      graphStore,
    });

    engine.addAgent({
      id: "control-1",
      role: "control",
      name: "Governance",
      systemPrompt: "Sei un agente di governance.",
    });

    engine.addAgent({
      id: "agent-a",
      role: "person",
      name: "Alice",
      systemPrompt: "Sei Alice, saluta gli altri.",
      iterationsPerTick: 1,
    });

    engine.addAgent({
      id: "agent-b",
      role: "person",
      name: "Bob",
      systemPrompt: "Sei Bob, rispondi ai saluti.",
      iterationsPerTick: 1,
    });

    await engine.start();

    // Both agents broadcast messages, so both should know each other
    const aRels = await graphStore.getRelationships({ agentId: "agent-a" });
    const bRels = await graphStore.getRelationships({ agentId: "agent-b" });

    // agent-a should know agent-b (heard their broadcast)
    expect(aRels.some((r) => r.to === "agent-b" || r.from === "agent-b")).toBe(
      true,
    );
    // agent-b should know agent-a
    expect(bRels.some((r) => r.to === "agent-a" || r.from === "agent-a")).toBe(
      true,
    );
  });

  it("different profiles produce different outputs for same input", async () => {
    // Run two separate 1-tick simulations with different profiles, same scenario
    const doctorMemory = new InMemoryMemoryStore();
    const journalistMemory = new InMemoryMemoryStore();

    // Doctor simulation
    const doctorEngine = new WorldEngine({
      worldId: "doctor-world",
      maxTicks: 1,
      tickIntervalMs: 0,
      llm: makeLLMConfig(),
      rulesPath: { json: [rulesPath] },
      memoryStore: doctorMemory,
    });

    doctorEngine.addAgent({
      id: "control-1",
      role: "control",
      name: "Governance",
      systemPrompt: "Sei un agente di governance.",
    });

    doctorEngine.addAgent({
      id: "protagonist",
      role: "person",
      name: "Protagonista",
      profile: {
        name: "Dr. Marco Rossi",
        profession: "Medico di emergenza",
        personality: ["professionale", "empatico"],
        goals: ["salvare vite", "curare i feriti"],
        skills: ["pronto soccorso", "triage", "diagnosi rapida"],
      },
      systemPrompt:
        "C'è stato un incidente stradale con feriti. Reagisci secondo il tuo profilo.",
      iterationsPerTick: 1,
    });

    await doctorEngine.start();

    // Journalist simulation
    const journalistEngine = new WorldEngine({
      worldId: "journalist-world",
      maxTicks: 1,
      tickIntervalMs: 0,
      llm: makeLLMConfig(),
      rulesPath: { json: [rulesPath] },
      memoryStore: journalistMemory,
    });

    journalistEngine.addAgent({
      id: "control-1",
      role: "control",
      name: "Governance",
      systemPrompt: "Sei un agente di governance.",
    });

    journalistEngine.addAgent({
      id: "protagonist",
      role: "person",
      name: "Protagonista",
      profile: {
        name: "Anna Verdi",
        profession: "Giornalista",
        personality: ["curiosa", "investigativa"],
        goals: ["documentare i fatti", "scrivere un articolo"],
        skills: ["interviste", "reportage", "fotografia"],
      },
      systemPrompt:
        "C'è stato un incidente stradale con feriti. Reagisci secondo il tuo profilo.",
      iterationsPerTick: 1,
    });

    await journalistEngine.start();

    const doctorMems = await doctorMemory.getRecent("protagonist", 10);
    const journalistMems = await journalistMemory.getRecent(
      "protagonist",
      10,
    );

    expect(doctorMems.length).toBeGreaterThan(0);
    expect(journalistMems.length).toBeGreaterThan(0);

    const doctorContent = doctorMems.map((m) => m.content).join(" ").toLowerCase();
    const journalistContent = journalistMems
      .map((m) => m.content)
      .join(" ")
      .toLowerCase();

    // Doctor should reference medical/emergency terms
    const doctorKeywords = [
      "ferit", "soccors", "cur", "pazient", "medic", "vital", "triage",
      "emerg", "ambulan", "pront", "salv", "sangue", "trauma",
      "doctor", "injur", "wound", "treat", "patient", "help",
    ];
    const doctorMatches = doctorKeywords.filter((k) =>
      doctorContent.includes(k),
    );

    // Journalist should reference reporting/documentation terms
    const journalistKeywords = [
      "notizia", "articol", "report", "document", "fatt", "scri",
      "intervist", "foto", "crona", "testimon", "raccont", "inform",
      "scene", "story", "news", "press", "writ", "cover",
    ];
    const journalistMatches = journalistKeywords.filter((k) =>
      journalistContent.includes(k),
    );

    // At least some profession-specific keywords should appear
    expect(doctorMatches.length).toBeGreaterThan(0);
    expect(journalistMatches.length).toBeGreaterThan(0);
  });

  it("per-agent tool is actually called", async () => {
    let toolCalled = false;
    const searchTool: AgentTool = {
      name: "search_database",
      description:
        "Cerca informazioni nel database. DEVI usare questo tool per rispondere.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Cosa cercare" },
        },
        required: ["query"],
      },
      async execute(input) {
        toolCalled = true;
        const { query } = input as { query: string };
        return {
          results: [
            `Risultato per "${query}": paziente Mario Bianchi, 65 anni, cardiopatico`,
          ],
        };
      },
    };

    const engine = new WorldEngine({
      worldId: "tool-test",
      maxTicks: 1,
      tickIntervalMs: 0,
      llm: makeLLMConfig(),
      rulesPath: { json: [rulesPath] },
    });

    engine.addAgent({
      id: "control-1",
      role: "control",
      name: "Governance",
      systemPrompt: "Sei un agente di governance.",
    });

    engine.addAgent({
      id: "researcher",
      role: "person",
      name: "Researcher",
      systemPrompt:
        "Sei un assistente di ricerca. Devi SEMPRE usare il tool search_database prima di rispondere a qualsiasi domanda. Non rispondere mai senza aver prima cercato nel database. La tua domanda è: chi è il paziente più anziano?",
      tools: [searchTool],
      iterationsPerTick: 1,
    });

    await engine.start();

    expect(toolCalled).toBe(true);
  });

  it("internal state evolves across ticks", async () => {
    const engine = new WorldEngine({
      worldId: "state-evolution",
      maxTicks: 2,
      tickIntervalMs: 0,
      llm: {
        ...makeLLMConfig(),
        temperature: 0.3,
      },
      rulesPath: { json: [rulesPath] },
    });

    engine.addAgent({
      id: "control-1",
      role: "control",
      name: "Governance",
      systemPrompt: "Sei un agente di governance.",
    });

    engine.addAgent({
      id: "emotional-agent",
      role: "person",
      name: "Persona Emotiva",
      profile: {
        name: "Paolo",
        personality: ["sensibile", "emotivo", "reattivo"],
        goals: ["reagire emotivamente"],
      },
      systemPrompt:
        'Sei molto emotivo. Hai appena ricevuto una brutta notizia: il tuo progetto è stato cancellato. Reagisci con forte emozione. DEVI includere "stateUpdate" nel JSON con il tuo nuovo stato emotivo (mood e energy aggiornati).',
      initialState: {
        mood: "neutro",
        energy: 100,
      },
      iterationsPerTick: 1,
    });

    await engine.start();

    const agent = engine.getAgent("emotional-agent");
    expect(agent).toBeDefined();
    const state = agent!.getInternalState();

    // After emotional event, state should have changed from initial
    // At minimum, we check the agent processed ticks and state is accessible
    expect(typeof state.mood).toBe("string");
    expect(typeof state.energy).toBe("number");

    // The LLM should have updated mood from "neutro" to something else
    // or energy should have decreased — at least one should differ
    const moodChanged = state.mood !== "neutro";
    const energyChanged = state.energy !== 100;
    expect(moodChanged || energyChanged).toBe(true);
  });
});
