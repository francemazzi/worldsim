import { describe, it, expect } from "vitest";
import { analyzeDialogue } from "../../src/analysis/DialogueAnalyzer.js";
import type { AgentAction } from "../../src/types/AgentTypes.js";
import type { Conversation } from "../../src/types/ConversationTypes.js";

function speak(agentId: string, tick: number, content: string, target?: string): AgentAction {
  return {
    agentId,
    actionType: "speak",
    tick,
    payload: target ? { content, target } : { content },
  };
}

function timedSpeak(
  agentId: string,
  tick: number,
  offset: number,
  content: string,
  target?: string,
): AgentAction {
  return {
    ...speak(agentId, tick, content, target),
    metadata: {
      tickSequence: offset,
      simulatedAtOffsetMs: offset,
      intraTickMs: offset,
      actionAtOffsetMs: offset,
      emittedAt: `2026-01-01T00:00:${String(Math.floor(offset / 1000)).padStart(2, "0")}.000Z`,
    },
  };
}

const agents = ["a", "b", "c"];

describe("analyzeDialogue", () => {
  it("returns empty structure when no speak actions exist", () => {
    const res = analyzeDialogue({ rawActions: [], agentIds: agents });
    expect(res.speakMatrix).toEqual([]);
    expect(res.voiceGini).toBe(0);
    expect(res.voiceByAgent.every((v) => v.speaks === 0)).toBe(true);
    expect(res.conversationStats.total).toBe(0);
  });

  it("builds a directed speak matrix from explicit targets", () => {
    const actions: AgentAction[] = [
      speak("a", 1, "hello", "b"),
      speak("a", 2, "again", "b"),
      speak("b", 3, "reply", "a"),
    ];
    const res = analyzeDialogue({ rawActions: actions, agentIds: agents });
    const ab = res.speakMatrix.find((e) => e.from === "a" && e.to === "b");
    const ba = res.speakMatrix.find((e) => e.from === "b" && e.to === "a");
    expect(ab?.count).toBe(2);
    expect(ba?.count).toBe(1);
  });

  it("infers recipients from an ongoing conversation when no target is set", () => {
    const actions: AgentAction[] = [
      speak("a", 5, "ciao tutti"),
      speak("b", 6, "risposta"),
    ];
    const conversations: Conversation[] = [
      {
        id: "c1",
        initiatorId: "a",
        participantIds: ["a", "b"],
        currentSpeakerId: "a",
        turnNumber: 2,
        startTick: 5,
        status: "active",
      },
    ];
    const res = analyzeDialogue({ rawActions: actions, conversations, agentIds: agents });
    const ab = res.speakMatrix.find((e) => e.from === "a" && e.to === "b");
    const ba = res.speakMatrix.find((e) => e.from === "b" && e.to === "a");
    expect(ab?.count).toBe(1);
    expect(ba?.count).toBe(1);
  });

  it("computes a positive voice Gini when participation is uneven", () => {
    const actions: AgentAction[] = [
      speak("a", 1, "x", "b"),
      speak("a", 2, "x", "b"),
      speak("a", 3, "x", "b"),
      speak("b", 4, "x", "a"),
    ];
    const res = analyzeDialogue({ rawActions: actions, agentIds: agents });
    expect(res.voiceGini).toBeGreaterThan(0);
    const aShare = res.voiceByAgent.find((v) => v.agentId === "a")!;
    expect(aShare.speaks).toBe(3);
  });

  it("measures response rate within the reply window", () => {
    const actions: AgentAction[] = [
      speak("a", 1, "hey", "b"),
      speak("b", 2, "hi", "a"),
      speak("a", 10, "solo", "c"),
    ];
    const res = analyzeDialogue({ rawActions: actions, agentIds: agents, replyWindow: 3 });
    const a = res.responseRate.find((r) => r.agentId === "a")!;
    expect(a.speaksOut).toBe(2);
    expect(a.repliesReceived).toBe(1);
    expect(a.rate).toBeCloseTo(0.5, 3);
  });

  it("uses intra-tick time when attributing replies within the same tick", () => {
    const actions: AgentAction[] = [
      timedSpeak("b", 1, 2000, "same tick reply", "a"),
      timedSpeak("a", 1, 1000, "same tick prompt", "b"),
    ];

    const res = analyzeDialogue({ rawActions: actions, agentIds: agents, replyWindow: 0 });

    const a = res.responseRate.find((r) => r.agentId === "a")!;
    expect(a.speaksOut).toBe(1);
    expect(a.repliesReceived).toBe(1);
  });
});
