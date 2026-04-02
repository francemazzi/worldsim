import { readFile } from "node:fs/promises";
import { RuleSetSchema } from "./RulesSchema.js";
import type { RuleSet } from "../types/RulesTypes.js";

export async function parseJsonRules(filePath: string): Promise<RuleSet> {
  const raw = await readFile(filePath, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`[JsonRulesParser] Invalid JSON in file: ${filePath}`);
  }

  const result = RuleSetSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `[JsonRulesParser] Schema validation failed for ${filePath}:\n${issues}`,
    );
  }

  return {
    ...result.data,
    source: "json",
    loadedAt: new Date(),
  };
}
