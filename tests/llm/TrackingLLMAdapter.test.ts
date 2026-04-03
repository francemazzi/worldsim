import { describe, it, expect, vi } from "vitest";
import { TrackingLLMAdapter } from "../../src/llm/TrackingLLMAdapter.js";
import { TokenBudgetTracker } from "../../src/scheduling/TokenBudgetTracker.js";
import type { LLMAdapter, LLMResponse } from "../../src/llm/LLMAdapter.js";

function makeMockLLM(response: LLMResponse): LLMAdapter {
  return {
    chat: vi.fn().mockResolvedValue(response),
    chatWithTools: vi.fn().mockResolvedValue(response),
  };
}

describe("TrackingLLMAdapter", () => {
  it("records token usage from chat()", async () => {
    const tracker = new TokenBudgetTracker();
    const inner = makeMockLLM({
      content: "hello",
      usage: { inputTokens: 10, outputTokens: 20 },
    });
    const adapter = new TrackingLLMAdapter(inner, "agent-1", tracker);

    await adapter.chat([{ role: "user", content: "hi" }]);

    const usage = tracker.getUsage("agent-1");
    expect(usage).toBeDefined();
    expect(usage!.tickTokens).toBe(30);
    expect(usage!.lifetimeTokens).toBe(30);
  });

  it("records token usage from chatWithTools()", async () => {
    const tracker = new TokenBudgetTracker();
    const inner = makeMockLLM({
      content: "result",
      usage: { inputTokens: 50, outputTokens: 100 },
    });
    const adapter = new TrackingLLMAdapter(inner, "agent-2", tracker);

    await adapter.chatWithTools([{ role: "user", content: "call tool" }], []);

    const usage = tracker.getUsage("agent-2");
    expect(usage).toBeDefined();
    expect(usage!.tickTokens).toBe(150);
  });

  it("accumulates usage across multiple calls", async () => {
    const tracker = new TokenBudgetTracker();
    const inner = makeMockLLM({
      content: "ok",
      usage: { inputTokens: 5, outputTokens: 5 },
    });
    const adapter = new TrackingLLMAdapter(inner, "agent-3", tracker);

    await adapter.chat([{ role: "user", content: "a" }]);
    await adapter.chat([{ role: "user", content: "b" }]);

    const usage = tracker.getUsage("agent-3");
    expect(usage!.tickTokens).toBe(20);
    expect(usage!.lifetimeTokens).toBe(20);
  });

  it("does not record when usage is undefined", async () => {
    const tracker = new TokenBudgetTracker();
    const inner = makeMockLLM({ content: "no usage" });
    const adapter = new TrackingLLMAdapter(inner, "agent-4", tracker);

    await adapter.chat([{ role: "user", content: "hi" }]);

    expect(tracker.getUsage("agent-4")).toBeUndefined();
  });

  it("delegates to inner adapter", async () => {
    const tracker = new TokenBudgetTracker();
    const inner = makeMockLLM({ content: "response" });
    const adapter = new TrackingLLMAdapter(inner, "agent-5", tracker);

    const result = await adapter.chat([{ role: "user", content: "hi" }]);

    expect(result.content).toBe("response");
    expect(inner.chat).toHaveBeenCalledOnce();
  });
});
