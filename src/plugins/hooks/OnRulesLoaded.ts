import type { RulesContext } from "../../types/RulesTypes.js";

export type OnRulesLoadedHook = (rules: RulesContext) => Promise<void>;
