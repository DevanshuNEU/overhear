import { describe, expect, it } from "vitest";
import { SAMPLE_REPORTS } from ".";

// Detection quotes are sentence-level: each quote is a whole sentence of its turn, minus one
// closing . ! or ?. Retell sometimes joins sentences with no space ("AM.You're"), so a boundary
// is a closing mark, optional spaces, or a line break.
function isWholeSentence(text: string, quote: string): boolean {
  const at = text.indexOf(quote);
  if (at < 0) return false;
  const before = text.slice(0, at);
  const after = text.slice(at + quote.length);
  const startsClean = before.trim() === "" || /[.!?]\s*$/.test(before) || /\n\s*$/.test(before);
  const endsClean = after.trim() === "" || /^[.!?]/.test(after);
  return startsClean && endsClean;
}

describe("sample detection quotes", () => {
  it("are whole sentences of the turn they cite", () => {
    for (const report of SAMPLE_REPORTS) {
      for (const d of report.detections) {
        const item = report.evidence.items.find((i) => i.kind === "turn" && i.seq === d.seq);
        expect(item, `${report.callId} seq ${d.seq}`).toBeDefined();
        const text = item && item.kind === "turn" ? item.text : "";
        expect(isWholeSentence(text, d.quote), `${report.callId} seq ${d.seq}: ${d.quote}`).toBe(true);
      }
    }
  });
});
