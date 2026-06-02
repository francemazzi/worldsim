import type { Stimulus } from "../types/StimulusTypes.js";

/**
 * A topic groups related stimuli together so the agent prompt can frame an
 * incoming percept as "you are reacting to X in topic Y" rather than as an
 * isolated event. Topics are tick-scoped: they expire after
 * `windowTicks` ticks of inactivity.
 *
 * The tracker is intentionally lightweight: it uses two cheap heuristics by
 * default (causal chain + co-participation) and exposes a hook for an
 * optional embedding-based similarity check when an `EmbeddingAdapter` is
 * available (Phase 7+).
 */
export interface Topic {
  id: string;
  /** Stimulus that opened the topic. */
  rootStimulusId: string;
  /** Tick the topic was opened on. */
  startTick: number;
  /** Tick of the last stimulus assigned to this topic. */
  lastTick: number;
  /** Agent ids that have contributed to the topic so far. */
  participants: Set<string>;
  /** Stimulus ids in chronological order. */
  stimulusIds: string[];
  /** Free-form label set by the integrator (e.g. "fishing", "blackout"). */
  label?: string | undefined;
}

export interface TopicTrackerOptions {
  /**
   * Idle ticks before a topic is considered closed. Default `5`.
   */
  windowTicks?: number | undefined;
  /**
   * Optional async classifier. When provided, the tracker calls it for any
   * stimulus that didn't match by causal/participation rules; if it returns
   * a topic id, the stimulus is appended to that topic.
   *
   * Intended for embedding-based similarity ("does this look semantically
   * close to topic X?"). The default tracker doesn't ship an implementation
   * — it's an integrator hook.
   */
  classify?: ((stim: Stimulus, openTopics: Topic[]) => string | null) | undefined;
}

let topicCounter = 0;
function nextTopicId(): string {
  topicCounter += 1;
  return `topic-${Date.now()}-${topicCounter}`;
}

export class TopicTracker {
  private readonly topics: Map<string, Topic> = new Map();
  /** Maps stimulus id → topic id for fast causal lookups. */
  private readonly stimToTopic: Map<string, string> = new Map();
  private readonly windowTicks: number;
  private readonly classify?: TopicTrackerOptions["classify"];

  constructor(options: TopicTrackerOptions = {}) {
    this.windowTicks = Math.max(1, options.windowTicks ?? 5);
    if (options.classify) this.classify = options.classify;
  }

  /**
   * Registers a stimulus with the tracker. Returns the topic id it was
   * assigned to (existing or new). Idempotent on the same `stim.id`.
   */
  ingest(stim: Stimulus): string {
    if (this.stimToTopic.has(stim.id)) {
      return this.stimToTopic.get(stim.id)!;
    }
    this.expireStale(stim.tick);

    // 1) Explicit topic on the stimulus → keep it.
    if (stim.topicId && this.topics.has(stim.topicId)) {
      return this.append(stim, stim.topicId);
    }
    if (stim.topicId) {
      return this.openTopic(stim, stim.topicId);
    }

    // 2) Causal chain: parent stimulus already in a topic.
    if (stim.causedByStimulusId) {
      const parentTopic = this.stimToTopic.get(stim.causedByStimulusId);
      if (parentTopic && this.topics.has(parentTopic)) {
        return this.append(stim, parentTopic);
      }
    }

    // 3) Co-participation: same source already speaking inside an open
    //    topic in the active window.
    const open = this.openTopicsForAgent(stim.source.id, stim.tick);
    if (open) return this.append(stim, open.id);

    // 4) Optional semantic classification.
    if (this.classify) {
      const candidates = this.openTopicsAt(stim.tick);
      const matched = this.classify(stim, candidates);
      if (matched && this.topics.has(matched)) {
        return this.append(stim, matched);
      }
    }

    // 5) Fallback: open a fresh topic.
    return this.openTopic(stim);
  }

  /**
   * Returns the current topic id for a stimulus, or `undefined` if the
   * tracker hasn't seen it.
   */
  topicOf(stimulusId: string): string | undefined {
    return this.stimToTopic.get(stimulusId);
  }

  getTopic(topicId: string): Topic | undefined {
    return this.topics.get(topicId);
  }

  /** Returns every topic still considered open at the given tick. */
  openTopicsAt(tick: number): Topic[] {
    const out: Topic[] = [];
    for (const t of this.topics.values()) {
      if (tick - t.lastTick <= this.windowTicks) out.push(t);
    }
    return out;
  }

  /** Returns every topic currently retained by the tracker. */
  listTopics(): Topic[] {
    return [...this.topics.values()];
  }

  /**
   * Returns the most recent open topic the given agent has spoken in within
   * the active window, if any.
   */
  openTopicsForAgent(agentId: string, tick: number): Topic | undefined {
    let best: Topic | undefined;
    for (const t of this.topics.values()) {
      if (!t.participants.has(agentId)) continue;
      if (tick - t.lastTick > this.windowTicks) continue;
      if (!best || t.lastTick > best.lastTick) best = t;
    }
    return best;
  }

  /**
   * Drops topics whose last activity is older than the window. Called
   * automatically on each ingest; safe to call externally too.
   */
  expireStale(currentTick: number): void {
    for (const [id, t] of this.topics) {
      if (currentTick - t.lastTick > this.windowTicks) {
        this.topics.delete(id);
        for (const sid of t.stimulusIds) this.stimToTopic.delete(sid);
      }
    }
  }

  /** Total topics tracked (open + recently closed not yet expired). */
  get size(): number {
    return this.topics.size;
  }

  clear(): void {
    this.topics.clear();
    this.stimToTopic.clear();
  }

  private openTopic(stim: Stimulus, forcedId?: string): string {
    const id = forcedId ?? nextTopicId();
    stim.topicId = id;
    const topic: Topic = {
      id,
      rootStimulusId: stim.id,
      startTick: stim.tick,
      lastTick: stim.tick,
      participants: new Set([stim.source.id]),
      stimulusIds: [stim.id],
    };
    this.topics.set(id, topic);
    this.stimToTopic.set(stim.id, id);
    return id;
  }

  private append(stim: Stimulus, topicId: string): string {
    const t = this.topics.get(topicId);
    if (!t) return this.openTopic(stim, topicId);
    stim.topicId = topicId;
    t.stimulusIds.push(stim.id);
    t.participants.add(stim.source.id);
    if (stim.tick > t.lastTick) t.lastTick = stim.tick;
    this.stimToTopic.set(stim.id, topicId);
    return topicId;
  }
}
