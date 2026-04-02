import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAICompatAdapter } from "../../src/llm/OpenAICompatAdapter.js";
import type { AgentMessage } from "../../src/types/AgentTypes.js";

vi.mock("openai", () => {
  const createMock = vi.fn();
  return {
    default: class OpenAI {
      chat = { completions: { create: createMock } };
    },
    __createMock: createMock,
  };
});

async function getCreateMock() {
  const mod = await import("openai");
  return (mod as unknown as { __createMock: ReturnType<typeof vi.fn> }).__createMock;
}

describe("OpenAICompatAdapter", () => {
  let adapter: OpenAICompatAdapter;

  beforeEach(async () => {
    const createMock = await getCreateMock();
    createMock.mockReset();

    createMock.mockResolvedValue({
      choices: [{ message: { content: "Hello!", tool_calls: null } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    adapter = new OpenAICompatAdapter({
      baseURL: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "test-model",
    });
  });

  it("chat() returns normalized LLMResponse", async () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "Hi" },
    ];
    const response = await adapter.chat(messages);
    expect(response.content).toBe("Hello!");
    expect(response.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("chatWithTools() parses tool calls from response", async () => {
    const createMock = await getCreateMock();
    createMock.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: "",
            tool_calls: [
              {
                id: "call-1",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: '{"city":"Rome"}',
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 15, completion_tokens: 8 },
    });

    const messages: AgentMessage[] = [
      { role: "user", content: "What is the weather?" },
    ];
    const tools = [
      {
        name: "get_weather",
        description: "Get weather for a city",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
        execute: vi.fn(),
      },
    ];

    const response = await adapter.chatWithTools(messages, tools);
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.name).toBe("get_weather");
    expect(response.toolCalls![0]!.arguments).toEqual({ city: "Rome" });
  });

  it("chat() handles tool messages with toolCallId", async () => {
    const createMock = await getCreateMock();
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: "Got it" } }],
      usage: null,
    });

    const messages: AgentMessage[] = [
      { role: "tool", content: '{"temp": 20}', toolCallId: "call-1", name: "get_weather" },
    ];
    const response = await adapter.chat(messages);
    expect(response.content).toBe("Got it");
    expect(response.usage).toBeUndefined();
  });
});
