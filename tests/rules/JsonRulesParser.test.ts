import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseJsonRules } from "../../src/rules/JsonRulesParser.js";

const fixtures = join(import.meta.dirname, "fixtures");

describe("JsonRulesParser", () => {
  it("parses a valid JSON file correctly", async () => {
    const rs = await parseJsonRules(join(fixtures, "valid-rules.json"));
    expect(rs.name).toBe("Test Rules");
    expect(rs.rules).toHaveLength(3);
    expect(rs.source).toBe("json");
    expect(rs.loadedAt).toBeInstanceOf(Date);
  });

  it("throws on malformed JSON", async () => {
    await expect(
      parseJsonRules(join(fixtures, "..", "..", "..", "tsconfig.json")),
    ).rejects.toThrow();
  });

  it("throws on invalid schema (missing 'instruction')", async () => {
    await expect(
      parseJsonRules(join(fixtures, "invalid-schema.json")),
    ).rejects.toThrow("Schema validation failed");
  });

  it("assigns default priority = 100 when not specified", async () => {
    const rs = await parseJsonRules(join(fixtures, "no-priority.json"));
    expect(rs.rules[0]!.priority).toBe(100);
  });
});
