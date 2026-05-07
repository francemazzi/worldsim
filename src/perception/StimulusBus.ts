import type { Stimulus, StimulusKind } from "../types/StimulusTypes.js";

let stimulusIdCounter = 0;
export function createStimulusId(): string {
  stimulusIdCounter += 1;
  return `stim-${Date.now()}-${stimulusIdCounter}`;
}

/**
 * Bus that transports stimuli emitted during a tick to whoever wants to read
 * them. Mirrors the public surface of `MessageBus` so the engine code that
 * already reasons in terms of "current tick + per-receiver lookup" can also
 * reason in terms of stimuli.
 *
 * The bus is intentionally dumb: it only stores stimuli and exposes
 * tick-bounded queries. Filtering by sense, distance and intensity is the
 * `PerceptionEngine`'s job.
 */
export class StimulusBus {
  private readonly perTick: Map<number, Stimulus[]> = new Map();
  private readonly bySource: Map<number, Map<string, Stimulus[]>> = new Map();
  private readonly byKind: Map<number, Map<StimulusKind, Stimulus[]>> = new Map();
  private _currentTick = 0;
  private readonly retentionTicks: number;

  constructor(retentionTicks: number = 1) {
    this.retentionTicks = Math.max(1, retentionTicks);
  }

  get currentTick(): number {
    return this._currentTick;
  }

  /**
   * Advances the internal clock and evicts stimuli older than the retention
   * window. Called once at the beginning of each tick by the runtime.
   */
  newTick(tick: number): void {
    this._currentTick = tick;
    if (!this.perTick.has(tick)) this.perTick.set(tick, []);
    if (!this.bySource.has(tick)) this.bySource.set(tick, new Map());
    if (!this.byKind.has(tick)) this.byKind.set(tick, new Map());
    // Keep `retentionTicks` ticks total, including the current one.
    const cutoff = tick - this.retentionTicks + 1;
    for (const t of this.perTick.keys()) {
      if (t < cutoff) {
        this.perTick.delete(t);
        this.bySource.delete(t);
        this.byKind.delete(t);
      }
    }
  }

  publish(stim: Stimulus): void {
    const tickBucket = this.ensureTick(stim.tick);
    tickBucket.push(stim);

    const sourceBucket = this.bySource.get(stim.tick)!;
    const arr = sourceBucket.get(stim.source.id);
    if (arr) arr.push(stim);
    else sourceBucket.set(stim.source.id, [stim]);

    const kindBucket = this.byKind.get(stim.tick)!;
    const kArr = kindBucket.get(stim.kind);
    if (kArr) kArr.push(stim);
    else kindBucket.set(stim.kind, [stim]);
  }

  /** Returns every stimulus emitted on the given tick. Empty if none. */
  getForTick(tick: number): Stimulus[] {
    return this.perTick.get(tick) ?? [];
  }

  /** Returns stimuli emitted by a given agent or entity on the given tick. */
  getBySource(sourceId: string, tick: number): Stimulus[] {
    return this.bySource.get(tick)?.get(sourceId) ?? [];
  }

  /** Returns stimuli of a given kind on the given tick. */
  getByKind(kind: StimulusKind, tick: number): Stimulus[] {
    return this.byKind.get(tick)?.get(kind) ?? [];
  }

  /** Total number of stimuli currently held across all retained ticks. */
  get size(): number {
    let total = 0;
    for (const arr of this.perTick.values()) total += arr.length;
    return total;
  }

  clear(): void {
    this.perTick.clear();
    this.bySource.clear();
    this.byKind.clear();
    this._currentTick = 0;
  }

  private ensureTick(tick: number): Stimulus[] {
    let arr = this.perTick.get(tick);
    if (!arr) {
      arr = [];
      this.perTick.set(tick, arr);
      this.bySource.set(tick, new Map());
      this.byKind.set(tick, new Map());
    }
    return arr;
  }
}
