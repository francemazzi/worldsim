import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { OpenAICompatAdapter } from "../../src/llm/OpenAICompatAdapter.js";
import {
  resolveEmergenceModels,
  resolveOpenRouterLlmConfig,
  runWorld,
  formatAwiLiteTable,
  loadMicroScenario,
} from "./helpers/emergenceStudyHarness.js";

config({ path: ".env" });

const openRouterKey = process.env.OPENROUTER_API_KEY;

describe.skipIf(!openRouterKey)("Emergence cross-vendor micro-study (OpenRouter)", () => {
  const models = resolveEmergenceModels();

  it("connects to OpenRouter via resolveLlmEnv()", async () => {
    const llm = resolveOpenRouterLlmConfig();
    const adapter = new OpenAICompatAdapter({
      ...llm,
      model: models.modelA,
      temperature: 0,
      maxTokens: 20,
    });

    const response = await adapter.chat([
      { role: "user", content: "Reply with exactly: PONG" },
    ]);

    expect(response.content.toUpperCase()).toContain("PONG");
    expect(response.usage?.inputTokens).toBeGreaterThan(0);
  }, 60_000);

  it("runs homogeneous model A world through maxTicks", async () => {
    const result = await runWorld("homogeneous_a", { models });

    expect(result.report.summary.totalTicks).toBe(models.maxTicks);
    expect(result.report.summary.totalActions).toBeGreaterThan(0);
    expect(result.report.metrics.totalSpeaks).toBeGreaterThan(0);

    const personAgents = result.report.agents.filter((a) => a.role === "person");
    expect(personAgents).toHaveLength(4);
    expect(result.awiLite.m1PopulationAlive).toBe(4);
  }, 180_000);

  it("runs homogeneous model B world through maxTicks", async () => {
    const result = await runWorld("homogeneous_b", { models });

    expect(result.report.summary.totalTicks).toBe(models.maxTicks);
    expect(result.report.summary.totalActions).toBeGreaterThan(0);

    const personAgents = result.report.agents.filter((a) => a.role === "person");
    expect(personAgents).toHaveLength(4);
    expect(result.awiLite.m1PopulationAlive).toBe(4);
  }, 180_000);

  it("runs mixed population with per-agent model overrides", async () => {
    const result = await runWorld("mixed", { models });

    expect(result.report.summary.totalTicks).toBe(models.maxTicks);
    expect(result.report.summary.totalActions).toBeGreaterThan(0);

    const personAgents = result.report.agents.filter((a) => a.role === "person");
    expect(personAgents).toHaveLength(4);
    expect(result.awiLite.m1PopulationAlive).toBe(4);
  }, 180_000);

  it("records policy trigger and prints AWI-lite comparison across conditions", async () => {
    const scenario = loadMicroScenario();
    const triggerTick = scenario.trigger?.atTick ?? 4;

    const homA = await runWorld("homogeneous_a", { models });
    const homB = await runWorld("homogeneous_b", { models });
    const mixed = await runWorld("mixed", { models });

    for (const result of [homA, homB, mixed]) {
      expect(result.report.summary.totalTicks).toBe(models.maxTicks);
      expect(result.report.timeline.some((e) => e.type === "policy_trigger")).toBe(true);

      const triggerEntry = result.report.timeline.find((e) => e.type === "policy_trigger");
      expect(triggerEntry?.tick).toBe(triggerTick);
    }

    const table = formatAwiLiteTable([homA.awiLite, homB.awiLite, mixed.awiLite]);
    console.log("\n--- Emergence AWI-lite comparison ---\n" + table + "\n");

    expect(homA.awiLite.totalActions).toBeGreaterThan(0);
    expect(homB.awiLite.totalActions).toBeGreaterThan(0);
    expect(mixed.awiLite.totalActions).toBeGreaterThan(0);
  }, 540_000);
});
