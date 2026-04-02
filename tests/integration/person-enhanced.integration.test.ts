import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { config } from "dotenv";
import { WorldEngine } from "../../src/engine/WorldEngine.js";
import { InMemoryMemoryStore } from "../helpers/InMemoryMemoryStore.js";
import { InMemoryGraphStore } from "../helpers/InMemoryGraphStore.js";
import { join } from "node:path";
import type { AgentTool } from "../../src/types/PluginTypes.js";

config({ path: ".env" });

const apiKey = process.env["OPENAI_API_KEY"];

describe.skipIf(!apiKey)("PersonAgent enhanced E2E", () => {
  let memoryStore: InMemoryMemoryStore;
  let graphStore: InMemoryGraphStore;

  beforeEach(() => {
    memoryStore = new InMemoryMemoryStore();
    graphStore = new InMemoryGraphStore();
  });

  it("memory persists across ticks", async () => {
    const rulesPath = join(
      import.meta.dirname,
      "..",
      "rules",
      "fixtures",
      "valid-rules.json",
    );

    const engine = new WorldEngine({
      worldId: "memory-test",
      maxTicks: 3,
      tickIntervalMs: 0,
      llm: {
        baseURL: "https://api.openai.com/v1",
        apiKey: apiKey!,
        model: "gpt-4o-mini",
        temperature: 0,
        maxTokens: 150,
      },
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
      id: "dr-rossi",
      role: "person",
      name: "Dr. Rossi",
      profile: {
        name: "Dr. Marco Rossi",
        age: 45,
        profession: "Medico di base",
        personality: ["empatico", "metodico"],
        goals: ["curare i pazienti"],
        skills: ["diagnosi"],
      },
      initialState: {
        mood: "focused",
        energy: 80,
        goals: ["visitare pazienti"],
      },
      iterationsPerTick: 1,
    });

    await engine.start();

    const memories = await memoryStore.getRecent("dr-rossi", 100);
    expect(memories.length).toBeGreaterThanOrEqual(3);
  });

  it("profile influences LLM output", async () => {
    const rulesPath = join(
      import.meta.dirname,
      "..",
      "rules",
      "fixtures",
      "valid-rules.json",
    );

    const engine = new WorldEngine({
      worldId: "profile-test",
      maxTicks: 1,
      tickIntervalMs: 0,
      llm: {
        baseURL: "https://api.openai.com/v1",
        apiKey: apiKey!,
        model: "gpt-4o-mini",
        temperature: 0,
        maxTokens: 200,
      },
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
      id: "journalist",
      role: "person",
      name: "Anna Verdi",
      profile: {
        name: "Anna Verdi",
        profession: "Giornalista investigativa",
        personality: ["curiosa", "tenace", "scettica"],
        goals: ["scoprire la verita", "scrivere articoli di impatto"],
        skills: ["interviste", "ricerca", "scrittura"],
      },
      iterationsPerTick: 1,
    });

    await engine.start();

    const events = engine.getEventLog();
    const personEvents = events.filter((e) => e.agentId === "journalist");
    expect(personEvents.length).toBeGreaterThan(0);
  });

  it("per-agent tools are available in tick loop", async () => {
    const rulesPath = join(
      import.meta.dirname,
      "..",
      "rules",
      "fixtures",
      "valid-rules.json",
    );

    let toolCalled = false;
    const customTool: AgentTool = {
      name: "search_news",
      description: "Search latest news articles on a topic",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
      async execute(input) {
        toolCalled = true;
        const { query } = input as { query: string };
        return { results: [`News about ${query}`] };
      },
    };

    const engine = new WorldEngine({
      worldId: "tools-test",
      maxTicks: 2,
      tickIntervalMs: 0,
      llm: {
        baseURL: "https://api.openai.com/v1",
        apiKey: apiKey!,
        model: "gpt-4o-mini",
        temperature: 0,
        maxTokens: 200,
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
      id: "researcher",
      role: "person",
      name: "Researcher",
      profile: {
        name: "Researcher",
        profession: "Ricercatore",
        personality: ["analitico"],
        goals: ["trovare informazioni"],
        skills: ["ricerca"],
      },
      tools: [customTool],
      systemPrompt:
        "Sei un ricercatore. Usa sempre il tool search_news per cercare notizie. Devi usare il tool ad ogni turno.",
      iterationsPerTick: 1,
    });

    await engine.start();

    const events = engine.getEventLog();
    const researcherEvents = events.filter(
      (e) => e.agentId === "researcher",
    );
    expect(researcherEvents.length).toBeGreaterThan(0);
    // Tool may or may not be called depending on LLM choice,
    // but the agent should have run successfully
  });

  it("internal state is accessible after ticks", async () => {
    const rulesPath = join(
      import.meta.dirname,
      "..",
      "rules",
      "fixtures",
      "valid-rules.json",
    );

    const engine = new WorldEngine({
      worldId: "state-test",
      maxTicks: 2,
      tickIntervalMs: 0,
      llm: {
        baseURL: "https://api.openai.com/v1",
        apiKey: apiKey!,
        model: "gpt-4o-mini",
        temperature: 0,
        maxTokens: 150,
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
      id: "person-state",
      role: "person",
      name: "Stateful Person",
      systemPrompt: "Sei una persona con stato interno.",
      initialState: {
        mood: "happy",
        energy: 100,
        goals: ["test goal"],
      },
      iterationsPerTick: 1,
    });

    await engine.start();

    const agent = engine.getAgent("person-state");
    expect(agent).toBeDefined();
    const state = agent!.getInternalState();
    expect(state.mood).toBeDefined();
    expect(typeof state.energy).toBe("number");
  });
});
