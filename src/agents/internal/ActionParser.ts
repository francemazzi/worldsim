import type {
  AgentAction,
  AgentInternalState,
} from "../../types/AgentTypes.js";

/** Subset of the JSON envelope the LLM is instructed to return. */
interface RawAgentAction {
  actionType?: string;
  content?: string;
  target?: string;
  stateUpdate?: Partial<AgentInternalState>;
}

export interface ParsedAction {
  actionType: AgentAction["actionType"];
  payload: unknown;
  stateUpdate?: Partial<AgentInternalState>;
}

const VALID_ACTION_TYPES: ReadonlySet<AgentAction["actionType"]> = new Set([
  "speak",
  "observe",
  "interact",
  "tool_call",
  "finish",
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

    const parsed = JSON.parse(jsonMatch[0]) as RawAgentAction;

    const actionType: AgentAction["actionType"] =
      parsed.actionType && VALID_ACTION_TYPES.has(parsed.actionType as AgentAction["actionType"])
        ? (parsed.actionType as AgentAction["actionType"])
        : "speak";

    const result: ParsedAction = {
      actionType,
      payload: parsed.content ?? parsed,
    };
    if (parsed.stateUpdate) {
      result.stateUpdate = parsed.stateUpdate;
    }
    return result;
  } catch {
    return fallback;
  }
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
