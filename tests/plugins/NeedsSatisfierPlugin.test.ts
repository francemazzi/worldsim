import { describe, it, expect, beforeEach } from "vitest";
import { NeedsSatisfierPlugin } from "../../src/plugins/built-in/NeedsSatisfierPlugin.js";
import { NeedsTracker } from "../../src/needs/NeedsTracker.js";
import { TopicTracker } from "../../src/perception/TopicTracker.js";
import { AgentRegistry } from "../../src/agents/AgentRegistry.js";
import type { AgentAction, AgentState } from "../../src/types/AgentTypes.js";
import type { BaseAgent } from "../../src/agents/BaseAgent.js";

function makeAction(partial: Partial<AgentAction> & { actionType: AgentAction["actionType"]; agentId: string }): AgentAction {
  return {
    payload: null,
    tick: 0,
    metadata: undefined,
    ...partial,
  };
}

function dummyState(agentId: string): AgentState {
  return {
    agentId,
    status: "running",
    currentMessages: [],
    loopCount: 0,
    ephemeralMemory: {},
  };
}

function makeAgent(id: string, energy = 80): BaseAgent {
  return {
    id,
    getInternalState() {
      return {
        mood: "neutral",
        energy,
        goals: [],
        beliefs: {},
        knowledge: {},
        custom: {},
      };
    },
  } as unknown as BaseAgent;
}

describe("NeedsSatisfierPlugin", () => {
  let needs: NeedsTracker;
  let topics: TopicTracker;
  let registry: AgentRegistry;

  beforeEach(() => {
    needs = new NeedsTracker();
    topics = new TopicTracker({ windowTicks: 5 });
    registry = new AgentRegistry();
    needs.initFromTemplate("alice", "humanBasic");
    registry.add(makeAgent("alice"));
  });

  it("eat rule satisfies hunger when payload mentions food", async () => {
    const plugin = new NeedsSatisfierPlugin();
    plugin.onRuntimeReady({ agentRegistry: registry, config: {} as never, needsTracker: needs, topicTracker: topics });

    await plugin.onAgentAction(
      makeAction({ agentId: "alice", actionType: "interact", payload: { content: "Mangio una mela" } }),
      dummyState("alice"),
    );
    needs.tick("alice");
    const hunger = needs.get("alice")!.needs.find((n) => n.id === "hunger")!;
    expect(hunger.value).toBeLessThan(0.2);
  });

  it("drink rule satisfies thirst with English keyword", async () => {
    const plugin = new NeedsSatisfierPlugin();
    plugin.onRuntimeReady({ agentRegistry: registry, config: {} as never, needsTracker: needs, topicTracker: topics });

    await plugin.onAgentAction(
      makeAction({ agentId: "alice", actionType: "interact", payload: "I drink some water" }),
      dummyState("alice"),
    );
    needs.tick("alice");
    const thirst = needs.get("alice")!.needs.find((n) => n.id === "thirst")!;
    expect(thirst.value).toBeLessThan(0.2);
  });

  it("rest rule fires on low energy with finish action", async () => {
    needs.adjust("alice", "fatigue", 0.6);
    registry.clear();
    registry.add(makeAgent("alice", 20));
    const plugin = new NeedsSatisfierPlugin();
    plugin.onRuntimeReady({ agentRegistry: registry, config: {} as never, needsTracker: needs, topicTracker: topics });

    await plugin.onAgentAction(
      makeAction({ agentId: "alice", actionType: "finish", payload: null }),
      dummyState("alice"),
    );
    needs.tick("alice");
    const fatigue = needs.get("alice")!.needs.find((n) => n.id === "fatigue")!;
    expect(fatigue.value).toBeLessThan(0.6);
  });

  it("social rule fires only when topic has multiple participants", async () => {
    const sharedTopicId = "topic-shared";
    topics.ingest({
      id: "stim-1",
      tick: 0,
      kind: "speech",
      channel: "voice",
      source: { kind: "agent", id: "alice" },
      content: "Ciao",
      topicId: sharedTopicId,
    });
    topics.ingest({
      id: "stim-2",
      tick: 0,
      kind: "speech",
      channel: "voice",
      source: { kind: "agent", id: "bob" },
      content: "Ehi",
      topicId: sharedTopicId,
    });

    const plugin = new NeedsSatisfierPlugin();
    plugin.onRuntimeReady({ agentRegistry: registry, config: {} as never, needsTracker: needs, topicTracker: topics });

    const initialSocial = needs.get("alice")!.needs.find((n) => n.id === "social")!.value;
    await plugin.onAgentAction(
      makeAction({
        agentId: "alice",
        actionType: "speak",
        payload: "Salve a tutti",
        metadata: { topicId: sharedTopicId } as never,
      }),
      dummyState("alice"),
    );
    needs.tick("alice");
    const social = needs.get("alice")!.needs.find((n) => n.id === "social")!.value;
    expect(social).toBeLessThan(initialSocial + 0.05);
  });

  it("custom rules with defaultRules: false replace the defaults", async () => {
    const customRule = {
      id: "custom-greet",
      match: (a: AgentAction) => a.actionType === "speak",
      apply: (_a: AgentAction, satisfy: (id: string, amt: number) => void) => satisfy("hunger", 0.5),
    };
    const plugin = new NeedsSatisfierPlugin({
      rules: [customRule],
      defaultRules: false,
      structuredRules: false,
    });
    plugin.onRuntimeReady({ agentRegistry: registry, config: {} as never, needsTracker: needs, topicTracker: topics });

    expect(plugin.getRules()).toHaveLength(1);

    await plugin.onAgentAction(
      makeAction({ agentId: "alice", actionType: "speak", payload: "Ciao" }),
      dummyState("alice"),
    );
    needs.tick("alice");
    const hunger = needs.get("alice")!.needs.find((n) => n.id === "hunger")!;
    expect(hunger.value).toBeLessThan(0.2);
  });

  it("does nothing when the agent has no needs registered", async () => {
    const plugin = new NeedsSatisfierPlugin();
    plugin.onRuntimeReady({ agentRegistry: registry, config: {} as never, needsTracker: needs, topicTracker: topics });

    const action = makeAction({ agentId: "stranger", actionType: "interact", payload: "Mangio" });
    const result = await plugin.onAgentAction(action, dummyState("stranger"));
    expect(result).toBe(action);
  });
});
