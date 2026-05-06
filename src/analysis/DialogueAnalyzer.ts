import type { AgentAction } from "../types/AgentTypes.js";
import type { Conversation } from "../types/ConversationTypes.js";
import {
  compareTimelineMetadata,
} from "../engine/IntraTickTimeline.js";
import type { TimelineMetadata } from "../types/TimelineTypes.js";
import type {
  ConversationStats,
  DialogueAnalysis,
  MessageLengthStat,
  ResponseRate,
  SpeakEdge,
  VoiceShare,
} from "../types/ReportTypes.js";

export interface DialogueAnalyzerInput {
  /** All agent actions collected during the run. */
  rawActions: AgentAction[];
  /** Conversations tracked by the ConversationManager (active + ended). */
  conversations?: Conversation[] | undefined;
  /** Agent ids in the world (used to stabilize output ordering). */
  agentIds: string[];
  /** Max tick distance for reply attribution (default 3). */
  replyWindow?: number;
}

const DEFAULT_REPLY_WINDOW = 3;

/** Builds the full dialogue analysis from rawActions and conversations. */
export function analyzeDialogue(input: DialogueAnalyzerInput): DialogueAnalysis {
  const replyWindow = input.replyWindow ?? DEFAULT_REPLY_WINDOW;
  const conversations = input.conversations ?? [];
  const agentIds = input.agentIds;

  const speakEvents = collectSpeakEvents(input.rawActions, conversations);
  const speakMatrix = buildSpeakMatrix(speakEvents, agentIds);
  const voiceByAgent = computeVoiceShare(speakEvents, agentIds);
  const voiceGini = gini(voiceByAgent.map((v) => v.speaks));
  const avgMessageChars = computeMessageLengthStats(speakEvents, agentIds);
  const conversationStats = computeConversationStats(conversations, agentIds);
  const responseRate = computeResponseRate(speakEvents, agentIds, replyWindow);

  return {
    speakMatrix,
    voiceGini: round4(voiceGini),
    voiceByAgent,
    avgMessageChars,
    conversationStats,
    responseRate,
  };
}

interface SpeakEvent {
  from: string;
  to: string;
  tick: number;
  content: string;
  directed: boolean;
  metadata?: TimelineMetadata | undefined;
}

function collectSpeakEvents(
  actions: AgentAction[],
  conversations: Conversation[],
): SpeakEvent[] {
  const events: SpeakEvent[] = [];
  const convByParticipantAtTick = indexConversations(conversations);
  for (const a of actions) {
    if (a.actionType !== "speak") continue;
    const content = extractContent(a.payload);
    const target = extractTarget(a.payload);
    if (target && target !== "*") {
      events.push({
        from: a.agentId,
        to: target,
        tick: a.tick,
        content,
        directed: true,
        ...(a.metadata ? { metadata: a.metadata } : {}),
      });
      continue;
    }
    const conv = findConversationForSpeakerAtTick(a.agentId, a.tick, convByParticipantAtTick);
    if (conv) {
      const others = conv.participantIds.filter((p) => p !== a.agentId);
      if (others.length === 1) {
        events.push({
          from: a.agentId,
          to: others[0]!,
          tick: a.tick,
          content,
          directed: true,
          ...(a.metadata ? { metadata: a.metadata } : {}),
        });
        continue;
      }
      for (const o of others) {
        events.push({
          from: a.agentId,
          to: o,
          tick: a.tick,
          content,
          directed: true,
          ...(a.metadata ? { metadata: a.metadata } : {}),
        });
      }
      continue;
    }
    events.push({
      from: a.agentId,
      to: "*",
      tick: a.tick,
      content,
      directed: false,
      ...(a.metadata ? { metadata: a.metadata } : {}),
    });
  }
  return events;
}

function indexConversations(conversations: Conversation[]): Map<string, Conversation[]> {
  const byAgent = new Map<string, Conversation[]>();
  for (const c of conversations) {
    for (const p of c.participantIds) {
      const list = byAgent.get(p) ?? [];
      list.push(c);
      byAgent.set(p, list);
    }
  }
  return byAgent;
}

function findConversationForSpeakerAtTick(
  agentId: string,
  tick: number,
  byAgent: Map<string, Conversation[]>,
): Conversation | undefined {
  const list = byAgent.get(agentId);
  if (!list) return undefined;
  for (const c of list) {
    if (c.startTick > tick) continue;
    // A conversation covers [startTick, ∞) until status=ended: we treat
    // the span as active up to (and including) the end tick or run end.
    return c;
  }
  return undefined;
}

function extractContent(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    if (typeof rec.content === "string") return rec.content;
  }
  return "";
}

function extractTarget(payload: unknown): string | undefined {
  if (payload && typeof payload === "object") {
    const rec = payload as Record<string, unknown>;
    const t = rec.target ?? rec.to;
    if (typeof t === "string") return t;
  }
  return undefined;
}

function buildSpeakMatrix(events: SpeakEvent[], agentIds: string[]): SpeakEdge[] {
  const known = new Set(agentIds);
  const counts = new Map<string, number>();
  for (const e of events) {
    const from = known.has(e.from) ? e.from : e.from;
    const to = e.to === "*" ? "*" : known.has(e.to) ? e.to : e.to;
    const key = `${from}|${to}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: SpeakEdge[] = [];
  for (const [key, count] of counts) {
    const [from, to] = key.split("|");
    if (!from || !to) continue;
    out.push({ from, to, count });
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

function computeVoiceShare(events: SpeakEvent[], agentIds: string[]): VoiceShare[] {
  const speaks = new Map<string, number>();
  const words = new Map<string, number>();
  for (const e of events) {
    if (!e.directed || e.to !== "*") {
      // Directed messages: count once per speak (not per recipient).
    }
  }
  // Re-count speaks: if directed multi-recipient, we exploded above. Use a
  // set of (from, tick, content) to dedupe.
  const seen = new Set<string>();
  for (const e of events) {
    const key = eventKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    speaks.set(e.from, (speaks.get(e.from) ?? 0) + 1);
    words.set(
      e.from,
      (words.get(e.from) ?? 0) + countWords(e.content),
    );
  }
  return agentIds.map((id) => ({
    agentId: id,
    speaks: speaks.get(id) ?? 0,
    wordsApprox: words.get(id) ?? 0,
  }));
}

function countWords(s: string): number {
  if (!s) return 0;
  return s.trim().split(/\s+/).filter(Boolean).length;
}

function computeMessageLengthStats(
  events: SpeakEvent[],
  agentIds: string[],
): MessageLengthStat[] {
  const perAgent = new Map<string, number[]>();
  const seen = new Set<string>();
  for (const e of events) {
    const key = eventKey(e);
    if (seen.has(key)) continue;
    seen.add(key);
    const list = perAgent.get(e.from) ?? [];
    list.push(e.content.length);
    perAgent.set(e.from, list);
  }
  return agentIds.map((id) => {
    const lens = perAgent.get(id) ?? [];
    if (lens.length === 0) return { agentId: id, avg: 0, stddev: 0 };
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    const variance =
      lens.reduce((a, b) => a + (b - avg) * (b - avg), 0) / lens.length;
    return {
      agentId: id,
      avg: Math.round(avg * 10) / 10,
      stddev: Math.round(Math.sqrt(variance) * 10) / 10,
    };
  });
}

function computeConversationStats(
  conversations: Conversation[],
  _agentIds: string[],
): ConversationStats {
  if (conversations.length === 0) {
    return { total: 0, avgTurns: 0, initiatedBy: {} };
  }
  const totalTurns = conversations.reduce((a, c) => a + (c.turnNumber ?? 0), 0);
  const initiatedBy: Record<string, number> = {};
  for (const c of conversations) {
    initiatedBy[c.initiatorId] = (initiatedBy[c.initiatorId] ?? 0) + 1;
  }
  return {
    total: conversations.length,
    avgTurns: Math.round((totalTurns / conversations.length) * 10) / 10,
    initiatedBy,
  };
}

function computeResponseRate(
  events: SpeakEvent[],
  agentIds: string[],
  window: number,
): ResponseRate[] {
  const sortedByTick = [...events].sort(compareSpeakEvents);
  const speaksOut = new Map<string, number>();
  const repliesReceived = new Map<string, number>();
  const seenOut = new Set<string>();

  for (let i = 0; i < sortedByTick.length; i++) {
    const e = sortedByTick[i]!;
    if (!e.directed || e.to === "*") continue;
    // Dedup directed speaks per (from, tick, content) across multiple recipients.
    const key = eventKey(e);
    if (!seenOut.has(key)) {
      seenOut.add(key);
      speaksOut.set(e.from, (speaksOut.get(e.from) ?? 0) + 1);
    }
    // Check for a reply from `to` back to `from` within the window.
    for (let j = i + 1; j < sortedByTick.length; j++) {
      const r = sortedByTick[j]!;
      if (r.tick - e.tick > window) break;
      if (r.from === e.to && r.directed && r.to === e.from) {
        repliesReceived.set(e.from, (repliesReceived.get(e.from) ?? 0) + 1);
        break;
      }
    }
  }

  return agentIds.map((id) => {
    const out = speaksOut.get(id) ?? 0;
    const rep = repliesReceived.get(id) ?? 0;
    return {
      agentId: id,
      speaksOut: out,
      repliesReceived: rep,
      rate: out === 0 ? 0 : Math.round((rep / out) * 1000) / 1000,
    };
  });
}

function compareSpeakEvents(a: SpeakEvent, b: SpeakEvent): number {
  const tickDiff = a.tick - b.tick;
  if (tickDiff !== 0) return tickDiff;

  const temporal = compareTimelineMetadata(a.metadata, b.metadata);
  if (temporal !== 0) return temporal;

  return a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.content.localeCompare(b.content);
}

function eventKey(event: SpeakEvent): string {
  const sequence = event.metadata?.tickSequence ?? "";
  const offset = event.metadata?.actionAtOffsetMs ?? event.metadata?.simulatedAtOffsetMs ?? "";
  return `${event.from}|${event.tick}|${offset}|${sequence}|${event.content}`;
}

function gini(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    weighted += (i + 1) * sorted[i]!;
  }
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

function round4(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 10000) / 10000;
}
