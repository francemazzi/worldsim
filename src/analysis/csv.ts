/**
 * Tiny CSV serializer with RFC-4180 quoting.
 * Zero external dependencies.
 */

export type CsvRow = Record<string, unknown>;

export function toCsv(rows: CsvRow[], columns?: string[]): string {
  if (rows.length === 0) {
    return columns ? columns.join(",") + "\n" : "";
  }
  const cols = columns ?? inferColumns(rows);
  const header = cols.map(escapeCell).join(",");
  const body = rows
    .map((row) => cols.map((c) => escapeCell(row[c])).join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

function inferColumns(rows: CsvRow[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) {
        seen.add(k);
        order.push(k);
      }
    }
  }
  return order;
}

function escapeCell(value: unknown): string {
  if (value == null) return "";
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "number" || typeof value === "boolean") text = String(value);
  else text = JSON.stringify(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
