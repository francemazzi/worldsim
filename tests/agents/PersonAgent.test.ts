import { describe, it, expect, vi, beforeEach } from "vitest";
import { PersonAgent } from "../../src/agents/PersonAgent.js";
import { MessageBus } from "../../src/messaging/MessageBus.js";
import { InMemoryMemoryStore } from "../helpers/InMemoryMemoryStore.js";
import { InMemoryGraphStore } from "../helpers/InMemoryGraphStore.js";
import type { LLMAdapter, LLMResponse } from "../../src/llm/LLMAdapter.js";
import type { AgentConfig } from "../../src/types/AgentTypes.js";
import type { WorldContext } from "../../src/types/WorldTypes.js";
import type { RulesContext } from "../../src/types/RulesTypes.js";
import type { AgentTool } from "../../src/types/PluginTypes.js";

function makeMockLLM(response?: string): LLMAdapter {
  const content =
    response ?? '{"actionType": "speak", "content": "Hello world"}';
  return {
    chat: vi.fn().mockResolvedValue({ content } satisfies LLMResponse),
    chatWithTools: vi
      .fn()
      .mockResolvedValue({ content } satisfies LLMResponse),
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

function makeTool(name: string): AgentTool {
  return {
    name,
    description: `Tool ${name}`,
    inputSchema: { type: "object", properties: {} },
    execute: vi.fn().mockResolvedValue({ result: "ok" }),
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

  // --- Existing lifecycle tests ---

  it("tick() returns [] if status = 'paused'", async () => {
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
    const slowLlm: LLMAdapter = {
      chat: vi
        .fn()
        .mockResolvedValue({
          content: '{"actionType": "speak", "content": "hi"}',
        }),
      chatWithTools: vi
        .fn()
        .mockResolvedValue({
          content: '{"actionType": "speak", "content": "hi"}',
        }),
    };

    const agent = new PersonAgent(
      makeConfig({ iterationsPerTick: 5 }),
      slowLlm,
      bus,
    );
    agent.start();

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
    expect(actions).toHaveLength(1);
  });

  // --- stateUpdate tests ---

  describe("stateUpdate from LLM", () => {
    it("applies stateUpdate returned by LLM", async () => {
      const llmWithState = makeMockLLM(
        '{"actionType": "speak", "content": "sad", "stateUpdate": {"mood": "triste", "energy": 30}}',
      );

      const agent = new PersonAgent(
        makeConfig({
          iterationsPerTick: 1,
          initialState: { mood: "neutro", energy: 100 },
        }),
        llmWithState,
        bus,
      );
      agent.start();
      await agent.tick(makeCtx(), makeRules());

      const state = agent.getInternalState();
      expect(state.mood).toBe("triste");
      expect(state.energy).toBe(30);
    });

    it("partial stateUpdate preserves other fields", async () => {
      const llmPartial = makeMockLLM(
        '{"actionType": "speak", "content": "ok", "stateUpdate": {"mood": "felice"}}',
      );

      const agent = new PersonAgent(
        makeConfig({
          iterationsPerTick: 1,
          initialState: { mood: "neutro", energy: 80, goals: ["goal1"] },
        }),
        llmPartial,
        bus,
      );
      agent.start();
      await agent.tick(makeCtx(), makeRules());

      const state = agent.getInternalState();
      expect(state.mood).toBe("felice");
      expect(state.energy).toBe(80);
      expect(state.goals).toEqual(["goal1"]);
    });

    it("no stateUpdate applies default energy decay", async () => {
      const agent = new PersonAgent(
        makeConfig({
          iterationsPerTick: 1,
          initialState: { mood: "calmo", energy: 50 },
        }),
        llm,
        bus,
      );
      agent.start();
      await agent.tick(makeCtx(), makeRules());

      const state = agent.getInternalState();
      expect(state.mood).toBe("calmo");
      // Default energy decay: -5 per action when no stateUpdate
      expect(state.energy).toBe(45);
    });
  });

  // --- Profile in prompt ---

  describe("profile injection in system prompt", () => {
    it("includes profile section when profile is set", async () => {
      const agent = new PersonAgent(
        makeConfig({
          iterationsPerTick: 1,
          profile: {
            name: "Dr. Rossi",
            profession: "Medico",
            personality: ["empatico"],
            goals: ["curare"],
          },
        }),
        llm,
        bus,
      );
      agent.start();
      await agent.tick(makeCtx(), makeRules());

      const chatFn = llm.chat as ReturnType<typeof vi.fn>;
      const systemMsg = chatFn.mock.calls[0][0][0] as { content: string };
      expect(systemMsg.content).toContain("--- IDENTITA ---");
      expect(systemMsg.content).toContain("Dr. Rossi");
      expect(systemMsg.content).toContain("Medico");
    });

    it("includes state section in system prompt", async () => {
      const agent = new PersonAgent(
        makeConfig({
          iterationsPerTick: 1,
          initialState: { mood: "felice", energy: 90 },
        }),
        llm,
        bus,
      );
      agent.start();
      await agent.tick(makeCtx(), makeRules());

      const chatFn = llm.chat as ReturnType<typeof vi.fn>;
      const systemMsg = chatFn.mock.calls[0][0][0] as { content: string };
      expect(systemMsg.content).toContain("--- STATO INTERNO ---");
      expect(systemMsg.content).toContain("felice");
      expect(systemMsg.content).toContain("90/100");
    });
  });

  // --- Memory in prompt ---

  describe("memory injection in prompt", () => {
    it("includes memory section when memoryStore has entries", async () => {
      const memoryStore = new InMemoryMemoryStore();
      await memoryStore.save({
        id: "mem-1",
        agentId: "person-1",
        tick: 0,
        type: "conversation",
        content: "Ho parlato con Alice",
        timestamp: new Date(),
      });

      const agent = new PersonAgent(
        makeConfig({ iterationsPerTick: 1 }),
        llm,
        bus,
        { memoryStore },
      );
      agent.start();
      await agent.tick(makeCtx(), makeRules());

      const chatFn = llm.chat as ReturnType<typeof vi.fn>;
      const systemMsg = chatFn.mock.calls[0][0][0] as { content: string };
      expect(systemMsg.content).toContain("--- MEMORIA RECENTE ---");
      expect(systemMsg.content).toContain("Ho parlato con Alice");
    });
  });

  // --- Relationships in prompt ---

  describe("relationship injection in prompt", () => {
    it("includes relationship section when graphStore has entries", async () => {
      const graphStore = new InMemoryGraphStore();
      await graphStore.addRelationship({
        from: "person-1",
        to: "alice",
        type: "trusts",
        strength: 0.9,
        since: 1,
      });

      const agent = new PersonAgent(
        makeConfig({ iterationsPerTick: 1 }),
        llm,
        bus,
        { graphStore },
      );
      agent.start();
      await agent.tick(makeCtx(), makeRules());

      const chatFn = llm.chat as ReturnType<typeof vi.fn>;
      const systemMsg = chatFn.mock.calls[0][0][0] as { content: string };
      expect(systemMsg.content).toContain("--- RELAZIONI ---");
      expect(systemMsg.content).toContain("alice");
      expect(systemMsg.content).toContain("trusts");
    });
  });

  // --- GraphStore write after interaction ---

  describe("graphStore updated after interactions", () => {
    it("creates relationship when receiving messages from other agents", async () => {
      const graphStore = new InMemoryGraphStore();

      // Simulate another agent speaking
      bus.publish({
        id: "msg-other",
        from: "agent-2",
        to: "*",
        type: "speak",
        content: "Ciao a tutti",
        tick: 1,
      });

      const agent = new PersonAgent(
        makeConfig({ iterationsPerTick: 1 }),
        llm,
        bus,
        { graphStore },
      );
      agent.start();
      await agent.tick(makeCtx(), makeRules());

      const rel = await graphStore.getRelationship(
        "person-1",
        "agent-2",
        "knows",
      );
      expect(rel).not.toBeNull();
      expect(rel!.strength).toBe(0.1);
      expect(rel!.since).toBe(1);
    });

    it("increases strength on repeated interactions", async () => {
      const graphStore = new InMemoryGraphStore();
      await graphStore.addRelationship({
        from: "person-1",
        to: "agent-2",
        type: "knows",
        strength: 0.3,
        since: 0,
      });

      bus.publish({
        id: "msg-other",
        from: "agent-2",
        to: "*",
        type: "speak",
        content: "Hello",
        tick: 1,
      });

      const agent = new PersonAgent(
        makeConfig({ iterationsPerTick: 1 }),
        llm,
        bus,
        { graphStore },
      );
      agent.start();
      await agent.tick(makeCtx(), makeRules());

      const rel = await graphStore.getRelationship(
        "person-1",
        "agent-2",
        "knows",
      );
      expect(rel!.strength).toBeCloseTo(0.4);
      expect(rel!.lastInteraction).toBe(1);
    });

    it("does not create self-relationship", async () => {
      const graphStore = new InMemoryGraphStore();

      const agent = new PersonAgent(
        makeConfig({ iterationsPerTick: 1 }),
        llm,
        bus,
        { graphStore },
      );
      agent.start();
      await agent.tick(makeCtx(), makeRules());

      // Agent publishes its own messages — should not create self-relationship
      const rels = await graphStore.getRelationships({ agentId: "person-1" });
      const selfRels = rels.filter(
        (r) => r.from === "person-1" && r.to === "person-1",
      );
      expect(selfRels).toHaveLength(0);
    });
  });

  // --- Tool merging ---

  describe("tool merging", () => {
    it("merges plugin tools with config tools", () => {
      const agent = new PersonAgent(
        makeConfig({
          iterationsPerTick: 1,
          tools: [makeTool("config-tool")],
        }),
        llm,
        bus,
      );

      agent.setTools([makeTool("plugin-tool")]);

      // Access internal tools via a tick and checking what's passed to graph
      // We verify indirectly: both tools should be available
      // The agent should have 2 tools total
      expect(
        (agent as unknown as { externalTools: AgentTool[] }).externalTools,
      ).toHaveLength(2);
    });

    it("config tools override plugin tools with same name", () => {
      const pluginTool = makeTool("shared-tool");
      pluginTool.description = "from plugin";

      const configTool = makeTool("shared-tool");
      configTool.description = "from config";

      const agent = new PersonAgent(
        makeConfig({
          iterationsPerTick: 1,
          tools: [configTool],
        }),
        llm,
        bus,
      );

      agent.setTools([pluginTool]);

      const tools = (
        agent as unknown as { externalTools: AgentTool[] }
      ).externalTools;
      expect(tools).toHaveLength(1);
      expect(tools[0].description).toBe("from config");
    });
  });

  // --- Memory persistence ---

  describe("memory persistence", () => {
    it("saves actions to memoryStore after tick", async () => {
      const memoryStore = new InMemoryMemoryStore();

      const agent = new PersonAgent(
        makeConfig({ iterationsPerTick: 2 }),
        llm,
        bus,
        { memoryStore },
      );
      agent.start();
      await agent.tick(makeCtx(), makeRules());

      const entries = await memoryStore.getRecent("person-1", 10);
      expect(entries).toHaveLength(2);
      expect(entries[0].type).toBe("action");
    });
  });

  // --- updateInternalState ---

  describe("updateInternalState", () => {
    it("partial update preserves unspecified fields", () => {
      const agent = new PersonAgent(
        makeConfig({
          initialState: {
            mood: "calmo",
            energy: 100,
            goals: ["a", "b"],
          },
        }),
        llm,
        bus,
      );

      agent.updateInternalState({ mood: "triste" });

      const state = agent.getInternalState();
      expect(state.mood).toBe("triste");
      expect(state.energy).toBe(100);
      expect(state.goals).toEqual(["a", "b"]);
    });

    it("goals are replaced entirely", () => {
      const agent = new PersonAgent(
        makeConfig({
          initialState: { goals: ["old"] },
        }),
        llm,
        bus,
      );

      agent.updateInternalState({ goals: ["new1", "new2"] });
      expect(agent.getInternalState().goals).toEqual(["new1", "new2"]);
    });

    it("beliefs are merged", () => {
      const agent = new PersonAgent(
        makeConfig({
          initialState: { beliefs: { a: 1 } },
        }),
        llm,
        bus,
      );

      agent.updateInternalState({ beliefs: { b: 2 } });
      const beliefs = agent.getInternalState().beliefs;
      expect(beliefs).toEqual({ a: 1, b: 2 });
    });

    it("multiple updates accumulate correctly", () => {
      const agent = new PersonAgent(makeConfig(), llm, bus);

      agent.updateInternalState({ mood: "felice", energy: 90 });
      agent.updateInternalState({ energy: 70, knowledge: { fact: true } });

      const state = agent.getInternalState();
      expect(state.mood).toBe("felice");
      expect(state.energy).toBe(70);
      expect(state.knowledge).toEqual({ fact: true });
    });
  });
});
