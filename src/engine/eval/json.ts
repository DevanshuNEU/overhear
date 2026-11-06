// JSON for the committed eval files (cases and the report), written so a diff shows the line that changed:
// two-space indents, except that anything nesting two levels or less stays on one line. A transcript item, a
// tool call, a label or one row of a confusion table is one line, rather than one word or one number per line.

/** How deep a value nests: 0 for a primitive, 1 for a container of primitives, and so on. */
function depth(v: unknown): number {
  if (v === null || typeof v !== "object") return 0;
  const kids = Array.isArray(v) ? v : Object.values(v);
  return 1 + kids.reduce((max: number, k) => Math.max(max, depth(k)), 0);
}

function toJson(v: unknown, indent: string): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  const isArray = Array.isArray(v);
  const entries: [string | null, unknown][] = isArray
    ? v.map((x) => [null, x])
    : Object.entries(v).filter(([, x]) => x !== undefined);
  if (entries.length === 0) return isArray ? "[]" : "{}";
  const one = (key: string | null, x: unknown, ind: string) => (key === null ? "" : `${JSON.stringify(key)}: `) + toJson(x, ind);
  if (depth(v) <= 2) {
    const body = entries.map(([k, x]) => one(k, x, "")).join(", ");
    return isArray ? `[${body}]` : `{ ${body} }`;
  }
  const inner = `${indent}  `;
  const body = entries.map(([k, x]) => inner + one(k, x, inner)).join(",\n");
  return isArray ? `[\n${body}\n${indent}]` : `{\n${body}\n${indent}}`;
}

/** The value as compact, deterministic JSON text, ending with a newline. */
export function compactJson(value: unknown): string {
  return `${toJson(value, "")}\n`;
}
