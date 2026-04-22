import { describe, it, expect } from "vitest";
import { toCsv } from "../../src/analysis/csv.js";

describe("toCsv", () => {
  it("returns only the header when rows are empty but columns are provided", () => {
    expect(toCsv([], ["a", "b"])).toBe("a,b\n");
  });

  it("returns empty string when there are no rows and no columns", () => {
    expect(toCsv([])).toBe("");
  });

  it("infers columns from the union of object keys, preserving first-seen order", () => {
    const out = toCsv([
      { a: 1, b: 2 },
      { b: 3, c: 4 },
    ]);
    expect(out).toBe("a,b,c\n1,2,\n,3,4\n");
  });

  it("quotes fields containing comma, quote or newline", () => {
    const out = toCsv([{ text: 'hi, "world"\nbye' }]);
    expect(out).toBe('text\n"hi, ""world""\nbye"\n');
  });

  it("serializes objects as JSON and handles booleans and numbers", () => {
    const out = toCsv([{ n: 1, b: true, o: { x: 1 } }], ["n", "b", "o"]);
    expect(out).toBe('n,b,o\n1,true,"{""x"":1}"\n');
  });
});
