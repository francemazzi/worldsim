import type {
  AgentAction,
  AgentInternalState,
} from "../../types/AgentTypes.js";
import type { TimelineMetadata } from "../../types/TimelineTypes.js";

/** Subset of the JSON envelope the LLM is instructed to return. */
interface RawAgentAction {
  actionType?: string;
  content?: string;
  target?: string;
  topicId?: string;
  inResponseTo?: string;
  intensity?: number;
  metadata?: Record<string, unknown>;
  stateUpdate?: Partial<AgentInternalState>;
}

export interface ParsedAction {
  actionType: AgentAction["actionType"];
  payload: unknown;
  metadata?: TimelineMetadata | undefined;
  stateUpdate?: Partial<AgentInternalState>;
}

const VALID_ACTION_TYPES: ReadonlySet<AgentAction["actionType"]> = new Set([
  "speak",
  "observe",
  "interact",
  "tool_call",
  "finish",
  "perceive",
]);

/**
 * Parses the raw LLM content into a structured {@link ParsedAction}.
 *
 * The contract is: the LLM returns free-form text that contains a JSON
 * object describing the action. If parsing fails, falls back to a
 * `speak` action with the raw content as payload.
 */
export function parseAgentAction(rawContent: string | undefined): ParsedAction {
  const content = rawContent ?? "";
  const fallback: ParsedAction = { actionType: "speak", payload: content };

  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(stripJsonComments(jsonMatch[0])) as RawAgentAction;

    const actionType: AgentAction["actionType"] =
      parsed.actionType && VALID_ACTION_TYPES.has(parsed.actionType as AgentAction["actionType"])
        ? (parsed.actionType as AgentAction["actionType"])
        : "speak";

    const result: ParsedAction = {
      actionType,
      payload: parsed.content ?? parsed,
    };
    const metadata = extractMetadata(parsed);
    if (metadata) {
      result.metadata = metadata;
    }
    if (parsed.stateUpdate) {
      result.stateUpdate = parsed.stateUpdate;
    }
    return result;
  } catch {
    return fallback;
  }
}

function extractMetadata(parsed: RawAgentAction): TimelineMetadata | undefined {
  const out: TimelineMetadata = {};
  if (parsed.metadata && typeof parsed.metadata === "object") {
    assignString(out, "topicId", parsed.metadata["topicId"]);
    assignString(out, "inResponseTo", parsed.metadata["inResponseTo"]);
    assignIntensity(out, parsed.metadata["intensity"]);
  }
  if (isUsefulId(parsed.topicId)) {
    out.topicId = parsed.topicId.trim();
  }
  if (isUsefulId(parsed.inResponseTo)) {
    out.inResponseTo = parsed.inResponseTo.trim();
  }
  if (typeof parsed.intensity === "number" && Number.isFinite(parsed.intensity)) {
    out.intensity = Math.max(0, Math.min(1, parsed.intensity));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function assignString(
  out: TimelineMetadata,
  key: "topicId" | "inResponseTo",
  value: unknown,
): void {
  if (isUsefulId(value)) {
    out[key] = value.trim();
  }
}

function assignIntensity(out: TimelineMetadata, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.intensity = Math.max(0, Math.min(1, value));
  }
}

function isUsefulId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  return trimmed !== "0"
    && trimmed.toLowerCase() !== "null"
    && trimmed.toLowerCase() !== "undefined"
    && trimmed !== "-";
}

function stripJsonComments(input: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    const next = input[i + 1];
    if (inString) {
      out += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Returns the energy cost (points to subtract from the agent's energy)
 * associated with a given action type. Used as a fallback when the LLM
 * does not include an explicit `stateUpdate.energy`.
 */
export function defaultEnergyCost(
  actionType: AgentAction["actionType"],
): number {
  switch (actionType) {
    case "observe":
      return 2;
    case "perceive":
      // Passive acknowledgement: the agent noticed something but did not
      // act on it. Should not deplete energy.
      return 0;
    case "finish":
      return 0;
    default:
      return 5;
  }
}

/**
 * Computes a new energy value after applying the default decay for the
 * given action type. Clamps at 0.
 */
export function applyEnergyDecay(
  currentEnergy: number,
  actionType: AgentAction["actionType"],
): number {
  const cost = defaultEnergyCost(actionType);
  return Math.max(0, currentEnergy - cost);
}
