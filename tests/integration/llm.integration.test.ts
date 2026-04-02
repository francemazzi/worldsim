import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { OpenAICompatAdapter } from "../../src/llm/OpenAICompatAdapter.js";

config({ path: ".env" });

const apiKey = process.env["OPENAI_API_KEY"];

describe.skipIf(!apiKey)("OpenAICompatAdapter integration", () => {
  it("sends a real chat request to OpenAI", async () => {
    const adapter = new OpenAICompatAdapter({
      baseURL: "https://api.openai.com/v1",
      apiKey: apiKey!,
      model: "gpt-4o-mini",
      temperature: 0,
      maxTokens: 50,
    });

    const response = await adapter.chat([
      { role: "user", content: "Reply with exactly: PONG" },
    ]);

    expect(response.content).toContain("PONG");
    expect(response.usage).toBeDefined();
    expect(response.usage!.inputTokens).toBeGreaterThan(0);
    expect(response.usage!.outputTokens).toBeGreaterThan(0);
  });

  it("sends a chat request with tools", async () => {
    const adapter = new OpenAICompatAdapter({
      baseURL: "https://api.openai.com/v1",
      apiKey: apiKey!,
      model: "gpt-4o-mini",
      temperature: 0,
    });

    const response = await adapter.chatWithTools(
      [{ role: "user", content: "What is the weather in Rome?" }],
      [
        {
          name: "get_weather",
          description: "Get current weather for a city",
          inputSchema: {
            type: "object",
            properties: { city: { type: "string" } },
            required: ["city"],
          },
          execute: async () => ({ temp: 22, condition: "sunny" }),
        },
      ],
    );

    expect(response.toolCalls).toBeDefined();
    expect(response.toolCalls!.length).toBeGreaterThanOrEqual(1);
    expect(response.toolCalls![0]!.name).toBe("get_weather");
  });
});
