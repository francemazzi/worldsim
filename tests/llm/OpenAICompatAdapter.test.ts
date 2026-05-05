import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

function openAIError(status: number, message = "OpenAI error") {
  return Object.assign(new Error(message), { status });
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

  afterEach(() => {
    vi.useRealTimers();
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

  it("chat() retries transient rate limit errors", async () => {
    vi.useFakeTimers();
    const createMock = await getCreateMock();
    createMock
      .mockRejectedValueOnce(openAIError(429, "rate limited"))
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Recovered" } }],
        usage: { prompt_tokens: 7, completion_tokens: 3 },
      });
    adapter = new OpenAICompatAdapter({
      baseURL: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "test-model",
      retryInitialDelayMs: 10,
      retryMaxDelayMs: 10,
    });

    const responsePromise = adapter.chat([{ role: "user", content: "Hi" }]);
    await vi.runAllTimersAsync();

    await expect(responsePromise).resolves.toEqual({
      content: "Recovered",
      usage: { inputTokens: 7, outputTokens: 3 },
    });
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("chat() does not retry non-transient errors", async () => {
    const createMock = await getCreateMock();
    const error = openAIError(400, "bad request");
    createMock.mockRejectedValueOnce(error);

    await expect(adapter.chat([{ role: "user", content: "Hi" }])).rejects.toBe(error);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("chat() stops retrying after maxRetries", async () => {
    vi.useFakeTimers();
    const createMock = await getCreateMock();
    const error = openAIError(503, "unavailable");
    createMock.mockRejectedValue(error);
    adapter = new OpenAICompatAdapter({
      baseURL: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "test-model",
      maxRetries: 2,
      retryInitialDelayMs: 10,
      retryMaxDelayMs: 10,
    });

    const responsePromise = adapter.chat([{ role: "user", content: "Hi" }]);
    const expectation = expect(responsePromise).rejects.toBe(error);
    await vi.runAllTimersAsync();

    await expectation;
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it("chatWithTools() retries transient errors", async () => {
    vi.useFakeTimers();
    const createMock = await getCreateMock();
    createMock
      .mockRejectedValueOnce(openAIError(500, "temporary failure"))
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Use tool", tool_calls: null } }],
        usage: { prompt_tokens: 11, completion_tokens: 4 },
      });
    adapter = new OpenAICompatAdapter({
      baseURL: "https://api.example.com/v1",
      apiKey: "test-key",
      model: "test-model",
      retryInitialDelayMs: 10,
      retryMaxDelayMs: 10,
    });

    const responsePromise = adapter.chatWithTools(
      [{ role: "user", content: "Check weather" }],
      [
        {
          name: "get_weather",
          description: "Get weather for a city",
          inputSchema: { type: "object" },
          execute: vi.fn(),
        },
      ],
    );
    await vi.runAllTimersAsync();

    await expect(responsePromise).resolves.toEqual({
      content: "Use tool",
      toolCalls: undefined,
      usage: { inputTokens: 11, outputTokens: 4 },
    });
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});
