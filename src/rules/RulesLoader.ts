import { glob } from "node:fs/promises";
import { parseJsonRules } from "./JsonRulesParser.js";
import { parsePdfRules } from "./PdfRulesParser.js";
import type { LLMAdapter } from "../llm/LLMAdapter.js";
import type { WorldConfig } from "../types/WorldTypes.js";
import type { Rule, RuleSet, RulesContext } from "../types/RulesTypes.js";

async function resolveGlobs(patterns: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const pattern of patterns) {
    if (pattern.includes("*")) {
      for await (const file of glob(pattern)) {
        files.push(file);
      }
    } else {
      files.push(pattern);
    }
  }
  return files;
}

export function buildRulesContext(ruleSets: RuleSet[]): RulesContext {
  const allRules = ruleSets.flatMap((rs) => rs.rules);
  allRules.sort((a, b) => a.priority - b.priority);

  return {
    ruleSets,
    getRulesForScope(scope: Rule["scope"]): Rule[] {
      return allRules.filter((r) => r.scope === scope || r.scope === "all");
    },
    getRuleById(id: string): Rule | undefined {
      return allRules.find((r) => r.id === id);
    },
  };
}

export class RulesLoader {
  constructor(private llm: LLMAdapter) {}

  async load(
    rulesPath: WorldConfig["rulesPath"],
  ): Promise<RulesContext> {
    const ruleSets: RuleSet[] = [];

    if (rulesPath?.json?.length) {
      const jsonFiles = await resolveGlobs(rulesPath.json);
      const jsonResults = await Promise.all(
        jsonFiles.map((f) => parseJsonRules(f)),
      );
      ruleSets.push(...jsonResults);
    }

    if (rulesPath?.pdf?.length) {
      const pdfFiles = await resolveGlobs(rulesPath.pdf);
      const pdfResults = await Promise.all(
        pdfFiles.map((f) => parsePdfRules(f, this.llm)),
      );
      ruleSets.push(...pdfResults);
    }

    return buildRulesContext(ruleSets);
  }
}
