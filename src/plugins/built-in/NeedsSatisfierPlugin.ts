import type { WorldSimPlugin } from "../../types/PluginTypes.js";
import type { AgentAction, AgentState } from "../../types/AgentTypes.js";
import type { NeedsTracker } from "../../needs/NeedsTracker.js";
import type { TopicTracker } from "../../perception/TopicTracker.js";
import type { AgentRegistry } from "../../agents/AgentRegistry.js";
import type { NeedsState } from "../../types/NeedsTypes.js";
import type { WorldContext } from "../../types/WorldTypes.js";
import type { ActivityScheduler } from "../../scheduling/ActivityScheduler.js";
import {
  type ConfigurablePlugin,
  type PluginRuntimeContext,
} from "../capabilities/ConfigurablePlugin.js";

/**
 * A `satisfy` callback handed to {@link NeedsSatisfyRule.apply}. The plugin
 * routes it through {@link NeedsTracker.satisfy} so rules don't depend on
 * the engine's internals.
 */
export type SatisfyFn = (needId: string, amount: number) => void;

/**
 * Helpers exposed to a rule when it fires. They let advanced rules look
 * beyond the action itself (current topic participants, agent energy).
 */
export interface NeedsSatisfyRuleContext {
  /** Topic id the action was attached to, when known. */
  topicId?: string | undefined;
  /** Number of distinct participants in that topic, including the actor. */
  topicParticipants?: number | undefined;
  /** Energy level of the actor (0-100), when available. */
  energy?: number | undefined;
}

export interface NeedsSatisfyRule {
  /** Optional human-readable id, useful for logging/debug. */
  id?: string | undefined;
  /**
   * Pure predicate. Should be cheap: it runs for every action, every tick.
   */
  match: (action: AgentAction, ctx: NeedsSatisfyRuleContext) => boolean;
  /**
   * Apply the satisfaction. Use the `satisfy` callback as many times as
   * needed (typically once).
   */
  apply: (
    action: AgentAction,
    satisfy: SatisfyFn,
    ctx: NeedsSatisfyRuleContext,
  ) => void;
}

export interface NeedsSatisfierPluginOptions {
  /** Custom rules appended to (or replacing) the defaults. */
  rules?: NeedsSatisfyRule[] | undefined;
  /** Include the built-in default rules (eat/drink/rest/talk). Default: `true`. */
  defaultRules?: boolean | undefined;
  /** Include affordance-verb and tool-result rules. Default: `true`. */
  structuredRules?: boolean | undefined;
}

/**
 * Patterns the default rules use to detect intent in free-form payloads.
 * Italian + English; case-insensitive.
 */
const EAT_PATTERN = /(\beat\b|\beating\b|\bate\b|\bfood\b|\bmangi\w*\b|\bmangia\w*\b|\bcibo\b|\bpranzo\b|\bcena\b|\bcolazion[ae]\b|\bspuntino\b)/i;
const DRINK_PATTERN = /(\bdrink\b|\bdrinking\b|\bdrank\b|\bwater\b|\bbere\b|\bbev\w*\b|\bcaff[eè]\b|\bacqua\b|\bt[eè]\b|\bbirra\b|\bvino\b)/i;
const REST_PATTERN = /(\brest(ing)?\b|\bsleep(ing)?\b|\bnap\b|\brelax\b|\bripos\w*\b|\bdorm\w*\b|\bpisolino\b)/i;

const AFFORDANCE_SATISFY: Record<string, { needId: string; amount: number }> = {
  eat: { needId: "hunger", amount: 0.35 },
  drink: { needId: "thirst", amount: 0.35 },
  sit: { needId: "fatigue", amount: 0.25 },
  rest: { needId: "fatigue", amount: 0.3 },
  sleep: { needId: "fatigue", amount: 0.4 },
  pet: { needId: "social", amount: 0.2 },
  talk: { needId: "social", amount: 0.15 },
};

/**
 * Default rule set. Each rule fires only when the corresponding need is
 * known to the {@link NeedsTracker}; the tracker silently drops calls for
 * unknown agents/needs, so the rules are safe to apply unconditionally.
 */
export function defaultNeedsSatisfyRules(): NeedsSatisfyRule[] {
  return [
    {
      id: "eat",
      match: (action) => action.actionType === "interact" && payloadMatches(action.payload, EAT_PATTERN),
      apply: (_action, satisfy) => satisfy("hunger", 0.3),
    },
    {
      id: "drink",
      match: (action) => action.actionType === "interact" && payloadMatches(action.payload, DRINK_PATTERN),
      apply: (_action, satisfy) => satisfy("thirst", 0.3),
    },
    {
      id: "rest-explicit",
      match: (action) => action.actionType === "interact" && payloadMatches(action.payload, REST_PATTERN),
      apply: (_action, satisfy) => satisfy("fatigue", 0.3),
    },
    {
      id: "rest-low-energy",
      match: (action, ctx) => {
        if (action.actionType !== "finish" && action.actionType !== "observe") return false;
        return typeof ctx.energy === "number" && ctx.energy < 30;
      },
      apply: (_action, satisfy) => satisfy("fatigue", 0.2),
    },
    {
      id: "social-talk",
      match: (action, ctx) => {
        if (action.actionType !== "speak") return false;
        return (ctx.topicParticipants ?? 0) >= 2;
      },
      apply: (_action, satisfy) => satisfy("social", 0.1),
    },
  ];
}

/** Rules that match structured affordance verbs and tool side-effects. */
export function structuredNeedsSatisfyRules(): NeedsSatisfyRule[] {
  return [
    {
      id: "affordance-verb",
      match: (action) => {
        if (action.actionType !== "interact") return false;
        const verb = extractAffordanceVerb(action.payload);
        return verb != null && verb in AFFORDANCE_SATISFY;
      },
      apply: (action, satisfy) => {
        const verb = extractAffordanceVerb(action.payload)!;
        const mapping = AFFORDANCE_SATISFY[verb]!;
        satisfy(mapping.needId, mapping.amount);
      },
    },
    {
      id: "tool-energy-restored",
      match: (action) => {
        const restored = extractNumericField(action.payload, "energyRestored");
        return restored != null && restored > 0;
      },
      apply: (action, satisfy) => {
        const restored = extractNumericField(action.payload, "energyRestored") ?? 0;
        satisfy("fatigue", Math.min(0.4, restored / 100));
      },
    },
    {
      id: "tool-harvest-food",
      match: (action) => {
        const payload = action.payload;
        if (!payload || typeof payload !== "object") return false;
        const rec = payload as Record<string, unknown>;
        return rec["harvested"] != null || rec["cropYield"] != null;
      },
      apply: (_action, satisfy) => satisfy("hunger", 0.25),
    },
    {
      id: "tool-social-effect",
      match: (action) => {
        const effect = extractStringField(action.payload, "socialEffect");
        return effect != null && /social|standing|friend/i.test(effect);
      },
      apply: (_action, satisfy) => satisfy("social", 0.15),
    },
  ];
}

/**
 * Built-in plugin that closes the needs feedback loop: it inspects every
 * agent action and applies "satisfy" deltas to the matching needs (eating
 * lowers hunger, drinking lowers thirst, resting lowers fatigue, talking
 * lowers social).
 *
 * The engine auto-registers this plugin in perception mode when agents have
 * needs, unless `interaction.autoNeedsSatisfier` is `false`.
 */
export class NeedsSatisfierPlugin implements WorldSimPlugin, ConfigurablePlugin {
  readonly name = "needs-satisfier";
  readonly version = "1.1.0";
  readonly parallel = true;

  private readonly rules: NeedsSatisfyRule[];
  private needsTracker?: NeedsTracker | undefined;
  private topicTracker?: TopicTracker | undefined;
  private agentRegistry?: AgentRegistry | undefined;
  private activityScheduler?: ActivityScheduler | undefined;

  constructor(options: NeedsSatisfierPluginOptions = {}) {
    const useDefaults = options.defaultRules ?? true;
    const useStructured = options.structuredRules ?? true;
    const base = useDefaults ? defaultNeedsSatisfyRules() : [];
    const structured = useStructured ? structuredNeedsSatisfyRules() : [];
    this.rules = [...base, ...structured, ...(options.rules ?? [])];
  }

  /** Returns the merged rule list (defaults + custom). Mostly useful for tests. */
  getRules(): readonly NeedsSatisfyRule[] {
    return this.rules;
  }

  onRuntimeReady(ctx: PluginRuntimeContext): void {
    this.needsTracker = ctx.needsTracker;
    this.topicTracker = ctx.topicTracker;
    this.agentRegistry = ctx.agentRegistry;
    this.activityScheduler = ctx.activityScheduler;
  }

  async onAgentAction(action: AgentAction, _state: AgentState): Promise<AgentAction> {
    const tracker = this.needsTracker;
    if (!tracker) return action;
    if (!tracker.get(action.agentId)) return action;

    const ruleCtx = this.buildContext(action);
    const satisfy: SatisfyFn = (needId, amount) => tracker.satisfy(action.agentId, needId, amount);

    for (const rule of this.rules) {
      if (rule.match(action, ruleCtx)) {
        rule.apply(action, satisfy, ruleCtx);
      }
    }
    return action;
  }

  async onNeedsTick(
    agentId: string,
    needs: NeedsState,
    ctx: WorldContext,
  ): Promise<NeedsState> {
    const agent = this.agentRegistry?.get(agentId);
    const schedule = agent?.getConfig().schedule;
    if (!schedule?.sleepCycle || !this.activityScheduler) return needs;

    const tick = ctx.tickCount;
    const inSleepWindow = !this.activityScheduler.shouldActivate(agentId, tick, schedule);
    if (!inSleepWindow) return needs;

    const out: NeedsState = {
      needs: needs.needs.map((n) => {
        if (n.id !== "fatigue") return { ...n };
        const regen = (n.regenPerTick ?? 0) + 0.02;
        const decay = n.decayPerTick ?? 0;
        const value = Math.max(0, n.value + decay - regen);
        return { ...n, regenPerTick: regen, value: Math.min(1, value) };
      }),
    };
    return out;
  }

  private buildContext(action: AgentAction): NeedsSatisfyRuleContext {
    const ctx: NeedsSatisfyRuleContext = {};
    const meta = action.metadata as Record<string, unknown> | undefined;
    const topicId = typeof meta?.["topicId"] === "string" ? (meta["topicId"] as string) : undefined;
    if (topicId) {
      ctx.topicId = topicId;
      const topic = this.topicTracker?.getTopic(topicId);
      if (topic) ctx.topicParticipants = topic.participants.size;
    }
    const agent = this.agentRegistry?.get(action.agentId);
    if (agent) ctx.energy = agent.getInternalState().energy;
    return ctx;
  }
}

function extractAffordanceVerb(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const rec = payload as Record<string, unknown>;
  for (const key of ["affordanceVerb", "verb", "action"]) {
    const v = rec[key];
    if (typeof v === "string" && v.length > 0) return v.toLowerCase();
  }
  return undefined;
}

function extractNumericField(payload: unknown, field: string): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const rec = payload as Record<string, unknown>;
  const v = rec[field];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const nested = rec["result"] ?? rec["toolResult"];
  if (nested && typeof nested === "object") {
    const inner = (nested as Record<string, unknown>)[field];
    if (typeof inner === "number" && Number.isFinite(inner)) return inner;
  }
  return undefined;
}

function extractStringField(payload: unknown, field: string): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const rec = payload as Record<string, unknown>;
  const v = rec[field];
  if (typeof v === "string") return v;
  const nested = rec["result"] ?? rec["toolResult"];
  if (nested && typeof nested === "object") {
    const inner = (nested as Record<string, unknown>)[field];
    if (typeof inner === "string") return inner;
  }
  return undefined;
}

function payloadMatches(payload: unknown, pattern: RegExp): boolean {
  const text = stringifyPayload(payload);
  return text ? pattern.test(text) : false;
}

function stringifyPayload(payload: unknown): string {
  if (payload == null) return "";
  if (typeof payload === "string") return payload;
  if (typeof payload === "number" || typeof payload === "boolean") return String(payload);
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const candidates = [
      obj["content"],
      obj["text"],
      obj["message"],
      obj["target"],
      obj["action"],
      obj["description"],
      obj["affordanceVerb"],
      obj["verb"],
    ].filter((v): v is string => typeof v === "string");
    if (candidates.length > 0) return candidates.join(" ");
    try {
      return JSON.stringify(payload);
    } catch {
      return "";
    }
  }
  return "";
}
