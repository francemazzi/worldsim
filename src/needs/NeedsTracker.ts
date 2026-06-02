import type {
  Need,
  NeedsState,
  NeedsTemplate,
} from "../types/NeedsTypes.js";

/**
 * Tracks per-agent NeedsState across ticks. Pure book-keeping: each tick
 * decays inactive needs and (when an external satisfier reports its work
 * via {@link satisfy}) regenerates the affected ones.
 *
 * Plugin authors are expected to register satisfiers — for example, the
 * AssetPlugin can call `satisfy(agentId, "hunger", 0.3)` whenever an
 * agent eats. The tracker stays neutral about the *world model*.
 */
export class NeedsTracker {
  private readonly state: Map<string, NeedsState> = new Map();
  /** Accumulated regeneration to apply at the next tick. */
  private readonly pendingRegen: Map<string, Map<string, number>> = new Map();

  initFromConfig(agentId: string, initial?: NeedsState | undefined): void {
    if (initial && initial.needs.length > 0) {
      this.state.set(agentId, cloneNeeds(initial));
    } else {
      this.state.set(agentId, { needs: [] });
    }
  }

  /**
   * Convenience alias for {@link initFromConfig} with a non-optional state.
   * Used by the bootstrap path where the caller already validated that the
   * agent declared a needs block.
   */
  init(agentId: string, initial: NeedsState): void {
    this.initFromConfig(agentId, initial);
  }

  initFromTemplate(agentId: string, template: NeedsTemplate): void {
    const tpl = buildTemplate(template);
    this.state.set(agentId, tpl);
  }

  get(agentId: string): NeedsState | undefined {
    return this.state.get(agentId);
  }

  /**
   * Replaces an agent's full needs state. Used by plugin hooks that apply
   * world effects after the tracker has advanced one tick.
   */
  set(agentId: string, needs: NeedsState): void {
    this.state.set(agentId, cloneNeeds(needs));
  }

  /**
   * Update the value of a single need. `delta` is added to the current
   * value and the result is clamped to [0, 1].
   */
  adjust(agentId: string, needId: string, delta: number): void {
    const ns = this.state.get(agentId);
    if (!ns) return;
    const need = ns.needs.find((n) => n.id === needId);
    if (!need) return;
    need.value = clamp01(need.value + delta);
  }

  /**
   * Schedule a regen amount to be applied on the next `tick()`. Negative
   * values are accepted (effectively makes the need worse).
   */
  satisfy(agentId: string, needId: string, amount: number): void {
    let map = this.pendingRegen.get(agentId);
    if (!map) {
      map = new Map();
      this.pendingRegen.set(agentId, map);
    }
    map.set(needId, (map.get(needId) ?? 0) + amount);
  }

  /**
   * Advance one tick: apply pending regeneration, then natural decay for
   * each active agent.
   */
  tick(agentId: string): NeedsState | undefined {
    const ns = this.state.get(agentId);
    if (!ns) return undefined;

    const regen = this.pendingRegen.get(agentId);
    if (regen) {
      for (const [needId, amount] of regen) {
        const need = ns.needs.find((n) => n.id === needId);
        if (need) need.value = clamp01(need.value - amount);
      }
      regen.clear();
    }

    for (const need of ns.needs) {
      const decay = need.decayPerTick ?? 0;
      const regenRate = need.regenPerTick ?? 0;
      need.value = clamp01(need.value + decay - regenRate);
    }

    return ns;
  }

  /** Returns every need above its activation threshold. */
  activeNeeds(agentId: string): Need[] {
    const ns = this.state.get(agentId);
    if (!ns) return [];
    return ns.needs.filter((n) => n.value >= (n.activationThreshold ?? 0.5));
  }

  /** Returns every need above its critical threshold. */
  criticalNeeds(agentId: string): Need[] {
    const ns = this.state.get(agentId);
    if (!ns) return [];
    return ns.needs.filter((n) => n.value >= (n.criticalThreshold ?? 0.9));
  }

  /**
   * Builds a list of dynamic goals based on currently active needs. The
   * goals are intentionally short — the LLM agent reads them in the prompt
   * and decides how to act.
   */
  dynamicGoals(agentId: string): string[] {
    const out: string[] = [];
    for (const n of this.activeNeeds(agentId)) {
      out.push(...needToGoals(n));
    }
    return out;
  }

  remove(agentId: string): void {
    this.state.delete(agentId);
    this.pendingRegen.delete(agentId);
  }

  clear(): void {
    this.state.clear();
    this.pendingRegen.clear();
  }
}

// ── Templates ──────────────────────────────────────────────────────

function buildTemplate(template: NeedsTemplate): NeedsState {
  switch (template) {
    case "humanBasic":
      return {
        needs: [
          { id: "hunger", label: "fame", value: 0.2, decayPerTick: 0.01, tags: ["food", "eat"] },
          { id: "thirst", label: "sete", value: 0.2, decayPerTick: 0.012, tags: ["water", "drink"] },
          { id: "fatigue", label: "stanchezza", value: 0.0, decayPerTick: 0.008, tags: ["rest", "sleep"] },
          { id: "social", label: "socialita", value: 0.3, decayPerTick: 0.005, tags: ["talk", "company"] },
        ],
      };
    case "animalBasic":
      return {
        needs: [
          { id: "hunger", label: "fame", value: 0.3, decayPerTick: 0.015, tags: ["food", "prey"] },
          { id: "thirst", label: "sete", value: 0.2, decayPerTick: 0.013, tags: ["water"] },
          { id: "fear", label: "paura", value: 0.0, decayPerTick: 0.005, tags: ["predator", "noise"] },
          { id: "territory", label: "territorio", value: 0.0, decayPerTick: 0.004, tags: ["intruder"] },
        ],
      };
    case "none":
    case "custom":
    default:
      return { needs: [] };
  }
}

function needToGoals(n: Need): string[] {
  const critical = n.value >= (n.criticalThreshold ?? 0.9);
  switch (n.id) {
    case "hunger": return [critical ? "Trovare cibo subito" : "Mangiare qualcosa"];
    case "thirst": return [critical ? "Bere subito" : "Bere"];
    case "fatigue": return [critical ? "Riposarsi subito" : "Riposare"];
    case "social": return ["Cercare compagnia"];
    case "fear": return [critical ? "Mettersi in salvo" : "Ridurre il rischio"];
    case "territory": return ["Difendere il territorio"];
    default: return [`Ridurre ${n.label ?? n.id}`];
  }
}

function cloneNeeds(ns: NeedsState): NeedsState {
  return {
    needs: ns.needs.map((n) => ({ ...n, ...(n.tags ? { tags: [...n.tags] } : {}) })),
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
