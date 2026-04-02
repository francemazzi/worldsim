import { describe, it, expect, vi, beforeEach } from "vitest";
import { PersonAgent } from "../../src/agents/PersonAgent.js";
import { MessageBus } from "../../src/messaging/MessageBus.js";
import type { LLMAdapter, LLMResponse } from "../../src/llm/LLMAdapter.js";
import type { AgentConfig } from "../../src/types/AgentTypes.js";
import type { WorldContext } from "../../src/types/WorldTypes.js";
import type { RulesContext } from "../../src/types/RulesTypes.js";

function makeMockLLM(): LLMAdapter {
  return {
    chat: vi.fn().mockResolvedValue({
      content: '{"actionType": "speak", "content": "Hello world"}',
    } satisfies LLMResponse),
    chatWithTools: vi.fn().mockResolvedValue({
      content: '{"actionType": "speak", "content": "Hello world"}',
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
    getRulesForScope: () => [],
    getRuleById: () => undefined,
  };
}

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: "person-1",
    role: "person",
    name: "Test Person",
    systemPrompt: "You are a test agent.",
    iterationsPerTick: 2,
    ...overrides,
  };
}

describe("PersonAgent", () => {
  let bus: MessageBus;
  let llm: LLMAdapter;

  beforeEach(() => {
    bus = new MessageBus();
    bus.newTick(1);
    llm = makeMockLLM();
  });

  it("tick() returns [] if status = 'paused' (shouldSkipTick guard)", async () => {
    const agent = new PersonAgent(makeConfig(), llm, bus);
    agent.start();
    agent.pause();
    const actions = await agent.tick(makeCtx(), makeRules());
    expect(actions).toEqual([]);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it("tick() returns [] if status = 'stopped'", async () => {
    const agent = new PersonAgent(makeConfig(), llm, bus);
    agent.start();
    agent.stop();
    const actions = await agent.tick(makeCtx(), makeRules());
    expect(actions).toEqual([]);
  });

  it("for loop breaks mid-loop if status changes to paused", async () => {
    let callCount = 0;
    const slowLlm: LLMAdapter = {
      chat: vi.fn().mockImplementation(async () => {
        callCount++;
        return { content: '{"actionType": "speak", "content": "hi"}' };
      }),
      chatWithTools: vi.fn().mockImplementation(async () => {
        callCount++;
        return { content: '{"actionType": "speak", "content": "hi"}' };
      }),
    };

    const agent = new PersonAgent(
      makeConfig({ iterationsPerTick: 5 }),
      slowLlm,
      bus,
    );
    agent.start();

    // Pause after first iteration by subscribing to bus
    const origTick = agent.tick.bind(agent);
    let firstActionDone = false;

    const originalPublish = bus.publish.bind(bus);
    bus.publish = (msg) => {
      originalPublish(msg);
      if (msg.type === "speak" && !firstActionDone) {
        firstActionDone = true;
        agent.pause(1, "test");
      }
    };

    const actions = await agent.tick(makeCtx(), makeRules());

    // Should have only 1 action because pause happens after first iteration
    expect(actions).toHaveLength(1);
  });
});
