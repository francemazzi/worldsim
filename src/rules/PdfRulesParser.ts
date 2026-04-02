import { PDFParse } from "pdf-parse";
import { readFile } from "node:fs/promises";
import { RuleSchema } from "./RulesSchema.js";
import type { LLMAdapter } from "../llm/LLMAdapter.js";
import type { Rule, RuleSet } from "../types/RulesTypes.js";

const EXTRACTION_SYSTEM_PROMPT = `Sei un estrattore di regole. Dato questo testo, estrai tutte le regole, linee guida, vincoli o istruzioni presenti e restituiscile ESCLUSIVAMENTE come JSON valido nel seguente schema: { "rules": Array<{"id": string, "priority": number, "scope": "world"|"control"|"person"|"all", "instruction": string, "enforcement": "hard"|"soft"}> }. Non aggiungere spiegazioni.`;

function chunkText(text: string, maxChars: number = 6000): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxChars));
    start += maxChars;
  }
  return chunks;
}

export async function parsePdfRules(
  filePath: string,
  llm: LLMAdapter,
): Promise<RuleSet> {
  const buffer = await readFile(filePath);
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const textResult = await parser.getText();
  const text = textResult.text;
  await parser.destroy();

  if (!text.trim()) {
    throw new Error(`[PdfRulesParser] No text extracted from PDF: ${filePath}`);
  }

  const chunks = chunkText(text);
  const allRules: Rule[] = [];

  for (const chunk of chunks) {
    const response = await llm.chat([
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: chunk },
    ]);

    let extracted: { rules?: unknown[] };
    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      extracted = JSON.parse(jsonMatch?.[0] ?? response.content) as {
        rules?: unknown[];
      };
    } catch {
      continue;
    }

    if (!Array.isArray(extracted.rules)) continue;

    for (const rawRule of extracted.rules) {
      const result = RuleSchema.safeParse(rawRule);
      if (result.success) {
        allRules.push(result.data);
      }
    }
  }

  const deduped = new Map<string, Rule>();
  for (const rule of allRules) {
    const existing = deduped.get(rule.id);
    if (!existing || rule.priority < existing.priority) {
      deduped.set(rule.id, rule);
    }
  }

  return {
    version: "1.0.0",
    name: `PDF Rules: ${filePath.split("/").pop() ?? filePath}`,
    rules: Array.from(deduped.values()),
    source: "pdf",
    loadedAt: new Date(),
  };
}
