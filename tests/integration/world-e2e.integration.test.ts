import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { WorldEngine } from "../../src/engine/WorldEngine.js";
import { join } from "node:path";

config({ path: ".env" });

const apiKey = process.env["OPENAI_API_KEY"];

describe.skipIf(!apiKey)("WorldEngine E2E integration", () => {
  it("runs a 3-tick simulation with real LLM", async () => {
    const rulesPath = join(import.meta.dirname, "..", "rules", "fixtures", "valid-rules.json");

    const engine = new WorldEngine({
      worldId: "e2e-test-world",
      maxTicks: 3,
      tickIntervalMs: 0,
      llm: {
        baseURL: "https://api.openai.com/v1",
        apiKey: apiKey!,
        model: "gpt-4o-mini",
        temperature: 0,
        maxTokens: 150,
      },
      rulesPath: {
        json: [rulesPath],
      },
    });

    engine.addAgent({
      id: "control-1",
      role: "control",
      name: "Governance",
      systemPrompt: "Sei un agente di governance. Monitora le regole.",
    });

    engine.addAgent({
      id: "person-1",
      role: "person",
      name: "Curiosa",
      iterationsPerTick: 1,
      systemPrompt: "Sei una persona curiosa. Fai domande.",
    });

    engine.addAgent({
      id: "person-2",
      role: "person",
      name: "Entusiasta",
      iterationsPerTick: 1,
      systemPrompt: "Sei una persona entusiasta. Proponi idee.",
    });

    const tickEvents: number[] = [];
    engine.on("tick", (tick) => {
      tickEvents.push(tick);
    });

    await engine.start();

    expect(engine.getStatus()).toBe("stopped");
    expect(engine.getContext().tickCount).toBe(3);
    expect(tickEvents).toEqual([1, 2, 3]);

    const events = engine.getEventLog();
    expect(events.length).toBeGreaterThan(0);
  }, 120_000);

  it("pauses and resumes an agent during simulation", async () => {
    const rulesPath = join(import.meta.dirname, "..", "rules", "fixtures", "valid-rules.json");

    const engine = new WorldEngine({
      worldId: "e2e-pause-test",
      maxTicks: 4,
      tickIntervalMs: 0,
      llm: {
        baseURL: "https://api.openai.com/v1",
        apiKey: apiKey!,
        model: "gpt-4o-mini",
        temperature: 0,
        maxTokens: 100,
      },
      rulesPath: {
        json: [rulesPath],
      },
    });

    engine.addAgent({
      id: "person-1",
      role: "person",
      name: "Test",
      iterationsPerTick: 1,
      systemPrompt: "Sei un agente di test.",
    });

    engine.on("tick", (tick) => {
      if (tick === 2) engine.pauseAgent("person-1", "Maintenance");
      if (tick === 3) engine.resumeAgent("person-1");
    });

    await engine.start();

    const events = engine.getEventLog();
    expect(events.some((e) => e.type === "agent:paused")).toBe(true);
    expect(events.some((e) => e.type === "agent:resumed")).toBe(true);
  }, 120_000);
});
