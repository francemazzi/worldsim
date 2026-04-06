import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { WorldEngine } from "../../src/engine/WorldEngine.js";

config({ path: ".env" });

const apiKey = process.env["OPENAI_API_KEY"];
const tavilyKey = process.env["TAVILY_API_KEY"];

describe.skipIf(!apiKey || !tavilyKey)("MCP Tavily — journalist agent", () => {
  it("agent uses Tavily MCP to search real news", async () => {
    const engine = new WorldEngine({
      worldId: "mcp-tavily-test",
      maxTicks: 1,
      tickIntervalMs: 0,
      llm: {
        baseURL: "https://api.openai.com/v1",
        apiKey: apiKey!,
        model: "gpt-4o-mini",
        temperature: 0,
        maxTokens: 500,
      },
    });

    engine.addAgent({
      id: "journalist",
      role: "person",
      name: "Marco Rossi",
      iterationsPerTick: 3,
      systemPrompt:
        "Sei Marco Rossi, giornalista investigativo. " +
        "DEVI usare il tool di ricerca Tavily per trovare le ultime notizie " +
        "da fonti autorevoli su un argomento a tua scelta. " +
        "Scrivi un breve sommario delle notizie trovate.",
      mcp: [
        {
          name: "tavily",
          transport: "stdio",
          command: "npx",
          args: ["-y", "tavily-mcp@latest"],
          env: { TAVILY_API_KEY: tavilyKey! },
          toolCallTimeoutMs: 30_000,
        },
      ],
    });

    await engine.start();

    expect(engine.getStatus()).toBe("stopped");
    expect(engine.getContext().tickCount).toBe(1);

    const events = engine.getEventLog();
    expect(events.length).toBeGreaterThan(0);

    // At least one action should be a tool_call (MCP Tavily search)
    const toolCallEvents = events.filter((e) => {
      const p = e.payload as { actionType?: string } | undefined;
      return e.type === "action:executed" && p?.actionType === "tool_call";
    });
    expect(toolCallEvents.length).toBeGreaterThan(0);
  }, 120_000);
});
