import { describe, expect, it } from "vitest";
import { splitSentences } from "@/engine/detect-speech";
import { SAMPLE_REPORTS } from ".";

// Detection quotes are sentence-level: each quote is a whole sentence of its turn, minus one
// closing . ! or ?. The sentences come from the detector's own splitter, so abbreviations such as
// "Dr." and "a.m." are never treated as boundaries.
function isWholeSentence(text: string, quote: string): boolean {
  return splitSentences(text).some((s) => s.trim().replace(/[.!?]$/, "").trimEnd() === quote);
}

describe("isWholeSentence", () => {
  const turn = "You are booked for Monday. Is that right? Great!";

  it("accepts a sentence without its closing mark", () => {
    expect(isWholeSentence(turn, "You are booked for Monday")).toBe(true);
    expect(isWholeSentence(turn, "Is that right")).toBe(true);
    expect(isWholeSentence(turn, "Great")).toBe(true);
  });

  it("rejects a quote that keeps the closing mark", () => {
    expect(isWholeSentence(turn, "You are booked for Monday.")).toBe(false);
    expect(isWholeSentence(turn, "Is that right?")).toBe(false);
    expect(isWholeSentence(turn, "Great!")).toBe(false);
  });

  it("rejects a fragment of a sentence", () => {
    expect(isWholeSentence(turn, "booked for Monday")).toBe(false);
  });

  it("does not split after a title", () => {
    const text = "I booked you with Dr. Priya Nair for Monday.";
    expect(isWholeSentence(text, "I booked you with Dr. Priya Nair for Monday")).toBe(true);
    expect(isWholeSentence(text, "Priya Nair for Monday")).toBe(false);
    expect(isWholeSentence(text, "Priya Nair")).toBe(false);
  });

  it("does not split after a.m. or p.m.", () => {
    const text = "You are booked for 9 a.m. tomorrow and 3 p.m. on Friday.";
    expect(isWholeSentence(text, "You are booked for 9 a.m. tomorrow and 3 p.m. on Friday")).toBe(true);
    expect(isWholeSentence(text, "tomorrow and 3 p.m. on Friday")).toBe(false);
    expect(isWholeSentence(text, "on Friday")).toBe(false);
  });
});

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
