import { describe, it, expect, vi, beforeEach } from "vitest";
import { ControlAgent } from "../../src/agents/ControlAgent.js";
import { MessageBus } from "../../src/messaging/MessageBus.js";
import type { LLMAdapter, LLMResponse } from "../../src/llm/LLMAdapter.js";
import type { AgentConfig, AgentAction } from "../../src/types/AgentTypes.js";
import type { WorldContext } from "../../src/types/WorldTypes.js";
import type { RulesContext } from "../../src/types/RulesTypes.js";

function makeMockLLM(): LLMAdapter {
  return {
    chat: vi.fn().mockResolvedValue({
      content: '["respectful communication", "contribution frequency"]',
    } satisfies LLMResponse),
    chatWithTools: vi.fn().mockResolvedValue({
      content: '[{"agentId": "p1", "actionType": "speak", "verdict": "approved"}]',
    } satisfies LLMResponse),
  };
}

function makeCtx(tick = 1): WorldContext {
  return {
    worldId: "test-world",
    tickCount: tick,
    startedAt: new Date(),
    metadata: {},
  };
}

function makeRules(): RulesContext {
  return {
    ruleSets: [],
    getRulesForScope: () => [
      {
        id: "r1",
        priority: 1,
        scope: "all" as const,
        instruction: "Be respectful",
        enforcement: "hard" as const,
      },
    ],
    getRuleById: (id) =>
      id === "r1"
        ? {
            id: "r1",
            priority: 1,
            scope: "all" as const,
            instruction: "Be respectful",
            enforcement: "hard" as const,
          }
        : undefined,
  };
}

function makeConfig(): AgentConfig {
  return {
    id: "control-1",
    role: "control",
    name: "Test Control",
    systemPrompt: "You are a governance agent.",
  };
}

describe("ControlAgent", () => {
  let bus: MessageBus;
  let llm: LLMAdapter;

  beforeEach(() => {
    bus = new MessageBus();
    bus.newTick(1);
    llm = makeMockLLM();
  });

  it("bootstrap extracts watch patterns from LLM", async () => {
    const agent = new ControlAgent(makeConfig(), llm, bus);
    agent.start();
    await agent.bootstrap(makeRules());
    expect(llm.chat).toHaveBeenCalledOnce();
  });

  it("tick() returns empty if not active", async () => {
    const agent = new ControlAgent(makeConfig(), llm, bus);
    const actions = await agent.tick(makeCtx(), makeRules());
    expect(actions).toEqual([]);
  });

  it("evaluateActions returns approved for valid actions", async () => {
    const agent = new ControlAgent(makeConfig(), llm, bus);
    agent.start();
    await agent.bootstrap(makeRules());

    const actions: AgentAction[] = [
      { agentId: "p1", actionType: "speak", payload: "Hello!", tick: 1 },
    ];

    const results = await agent.evaluateActions(actions, makeCtx(), makeRules());
    expect(results).toHaveLength(1);
    expect(results[0]!.verdict).toBe("approved");
  });

  it("evaluateActions returns empty array for empty actions", async () => {
    const agent = new ControlAgent(makeConfig(), llm, bus);
    agent.start();
    const results = await agent.evaluateActions([], makeCtx(), makeRules());
    expect(results).toEqual([]);
  });
});
