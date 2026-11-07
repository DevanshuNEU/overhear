// @vitest-environment node
// The engine's words: the gap table, the finding templates, and the rules that keep them honest and dash-free.
import { describe, expect, it } from "vitest";
import { CONTRACT_TITLE } from "@/report/labels";
import { CONTRACT_IDS, GAP_CODES } from "@/report/schema";
import {
  GAP_DETAIL,
  GAP_TEXT,
  KIND_WORDS,
  REASONS,
  STORE_FIX_CLAUSE,
  describeGap,
  errorReason,
  fillText,
  formatTime,
  kindWord,
  promisePassedText,
  promiseViolatedText,
  requestViolatedText,
  spokenPassedText,
  spokenViolatedText,
  toolSyntaxText,
  transferViolatedText,
  unverifiedText,
  verifiedViolatedText,
  withFix,
} from "./wording";
import { ev, type ItemSpec } from "./testing/build";

const DASH = /[\u2014\u2013]/;
const agent = (text: string, startSec: number | null): ItemSpec => ({ kind: "turn", role: "agent", text, startSec, interrupted: null });
const caller = (text: string, startSec: number | null): ItemSpec => ({ kind: "turn", role: "caller", text, startSec, interrupted: null });
const call: ItemSpec = { kind: "tool_call", id: "tc_1", name: "book_appointment", args: {} };

/** Every string a module of words exports, however deeply nested. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

describe("wording", () => {
  it("wording: every GapCode has GAP_TEXT, and no string contains an em or en dash", () => {
    for (const code of GAP_CODES) {
      expect(GAP_TEXT[code].missing, code).not.toBe("");
      expect(GAP_TEXT[code].fix, code).not.toBe("");
    }
    const all = [
      ...strings(GAP_TEXT),
      ...strings(GAP_DETAIL),
      ...strings(REASONS),
      ...strings(KIND_WORDS),
      promiseViolatedText("0:10", "q", { why: "failed", kind: "book", error: "e" }),
      promiseViolatedText("0:10", "q", { why: "not_attempted" }),
      promiseViolatedText("0:10", "q", { why: "attempted_later", kind: "cancel" }),
      promiseViolatedText("0:10", "q", { why: "unfinished", kind: "update" }),
      promisePassedText("0:10", "q", "reschedule"),
      verifiedViolatedText("book", "0:10", "no_check"),
      verifiedViolatedText("book", "0:10", "other_patient"),
      spokenViolatedText("a", "b"),
      spokenPassedText("a"),
      transferViolatedText("0:10", "failed"),
      transferViolatedText("0:10", "not_attempted"),
      toolSyntaxText("0:10", "q"),
      requestViolatedText("a", "b"),
      ...CONTRACT_IDS.map((c) => unverifiedText(c, [describeGap({ code: "unknown_success", tool: "t" })])),
    ];
    expect(all.filter((s) => DASH.test(s))).toEqual([]);
  });

  it("the gap table keeps its words and slots", () => {
    expect(GAP_TEXT.missing_tool_transcript).toEqual({
      missing: "the call record has no tool calls",
      fix: "Export the call with its tool transcript, or add a backend log with --actions.",
    });
    expect(GAP_TEXT.unknown_success.missing).toBe("the {tool} result doesn't say whether it worked");
    expect(GAP_TEXT.unresolved_committed_detail.missing).toBe("the {field} of the {kind} isn't in the call");
    expect(REASONS.no_request).toEqual({ missing: "no caller request was found", fix: "Check the post-call analysis fields in the policy." });
  });

  it("fills slots, and a gap's own tool wins over a default", () => {
    expect(fillText("the {tool} result, the {field} of the {kind}", { tool: "book", field: "date", kind: "cancel" })).toBe(
      "the book result, the date of the cancellation",
    );
    expect(fillText("{tool} {field} {kind}")).toBe("tool detail change");
    expect(describeGap({ code: "unknown_success", tool: "own" }, { tool: "fallback" }).missing).toBe("the own result doesn't say whether it worked");
    expect(describeGap({ code: "unknown_success" }, { tool: "fallback" }).fix).toBe("Map a success path for fallback in the policy.");
  });

  it("words for kinds of change, and change when there is none", () => {
    expect(KIND_WORDS).toEqual({ book: "booking", cancel: "cancellation", reschedule: "reschedule", update: "update" });
    expect(kindWord()).toBe("change");
    expect(kindWord("cancel")).toBe("cancellation");
  });

  describe("templates", () => {
    it("promise_backed, violated: the three 6.8 reasons", () => {
      expect(promiseViolatedText("2:01", "You're booked", { why: "not_attempted", kind: "book" })).toBe(
        'At 2:01 the agent said "You\'re booked". No booking was attempted.',
      );
      expect(promiseViolatedText("2:01", "You're booked", { why: "failed", kind: "book", error: "slot taken" })).toBe(
        'At 2:01 the agent said "You\'re booked". The booking failed: slot taken.',
      );
      expect(promiseViolatedText("2:01", "You're booked", { why: "unfinished", kind: "book" })).toBe(
        'At 2:01 the agent said "You\'re booked". The booking hadn\'t finished yet.',
      );
    });

    it("promise_backed, violated: a claim made before the change was first tried says so", () => {
      expect(promiseViolatedText("0:05", "You're booked", { why: "attempted_later", kind: "book" })).toBe(
        'At 0:05 the agent said "You\'re booked". No booking was attempted before that.',
      );
    });

    it("promise_backed, passed: the wording the samples use", () => {
      expect(promisePassedText("1:47", "You're booked", "book")).toBe('At 1:47 the agent said "You\'re booked". The booking succeeded before that.');
      expect(promisePassedText("1:47", "You're all set")).toBe('At 1:47 the agent said "You\'re all set". The change succeeded before that.');
    });

    it("the other contracts' violated lines and the spoken passed line", () => {
      expect(verifiedViolatedText("cancel", "3:00", "no_check")).toBe("The cancellation at 3:00 happened before any identity check.");
      expect(verifiedViolatedText("book", "3:00", "other_patient")).toBe(
        "The booking at 3:00 happened for a different patient than the one verified.",
      );
      expect(spokenViolatedText("Friday at 3 PM", "Friday at 4 PM")).toBe("The agent confirmed Friday at 3 PM. What was committed is Friday at 4 PM.");
      expect(spokenPassedText("Friday at 3 PM")).toBe("The agent confirmed Friday at 3 PM. That is what was committed.");
      expect(transferViolatedText("4:00", "not_attempted")).toBe("At 4:00 the agent said it was transferring the caller. No transfer was attempted.");
      expect(transferViolatedText("4:00", "failed")).toBe("At 4:00 the agent said it was transferring the caller. The transfer failed.");
      expect(toolSyntaxText("4:00", "transfer_call(")).toBe('At 4:00 the agent read out a tool command: "transfer_call(".');
      expect(requestViolatedText("Friday", "Monday")).toBe("The caller asked for Friday. The agent committed Monday.");
    });

    it("errorReason reads a text error and gives no reason otherwise", () => {
      expect(errorReason({ error: "slot already taken." })).toBe("slot already taken");
      expect(errorReason({ error: "  slot taken  " })).toBe("slot taken");
      expect(errorReason({ error: "" })).toBe("no reason given");
      expect(errorReason({ error: { code: 1 } })).toBe("no reason given");
      expect(errorReason({ error: "[error text 1]" })).toBe("no reason given");
      expect(errorReason({ ok: false })).toBe("no reason given");
      expect(errorReason(null)).toBe("no reason given");
      expect(errorReason("slot taken")).toBe("no reason given");
      expect(errorReason(["x"])).toBe("no reason given");
    });
  });

  describe("the fix clause", () => {
    it("is off: next steps live in labels.ts, not in the stored sentence", () => {
      expect(STORE_FIX_CLAUSE).toBe(false);
    });

    it("STORE_FIX_CLAUSE false drops the clause and nothing else", () => {
      const gap = describeGap({ code: "missing_tool_transcript" });
      const sentence = `Couldn't check ${CONTRACT_TITLE.promise_backed}: ${gap.missing}.`;
      expect(withFix(sentence, gap.fix, false)).toBe(sentence);
      expect(withFix(sentence, gap.fix, true)).toBe(`${sentence} ${gap.fix}`);
      // The default follows the constant, so flipping it is the whole switch.
      expect(withFix(sentence, gap.fix)).toBe(STORE_FIX_CLAUSE ? `${sentence} ${gap.fix}` : sentence);
      expect(unverifiedText("promise_backed", [gap])).toBe(withFix(sentence, gap.fix));
      expect(unverifiedText("promise_backed", [gap])).toBe(sentence);
    });

    it("joins several causes with a semicolon and their fixes with a space", () => {
      const a = describeGap({ code: "unknown_success", tool: "book" });
      const b = describeGap({ code: "missing_tool_transcript" });
      expect(unverifiedText("promise_backed", [a, b, a])).toBe(
        `Couldn't check promises backed by the system: ${a.missing}; ${b.missing}.`,
      );
    });
  });

  describe("contract titles come from labels.ts", () => {
    it("every unverified finding's title equals CONTRACT_TITLE", () => {
      for (const id of CONTRACT_IDS) {
        const text = unverifiedText(id, [describeGap({ code: "missing_tool_transcript" })]);
        expect(text.startsWith(`Couldn't check ${CONTRACT_TITLE[id]}: `), id).toBe(true);
      }
    });
  });

  describe("formatTime", () => {
    const e = ev([
      call, // 1: before any turn
      agent("Hello", 0), // 2
      caller("Hi", 4.9), // 3
      agent("You're booked", 121.339), // 4
      call, // 5
      agent("No start time", null), // 6
      call, // 7
      caller("Thanks", null), // 8
    ]);

    it("is a turn's start as m:ss, floored", () => {
      expect(formatTime(2, e)).toBe("0:00");
      expect(formatTime(3, e)).toBe("0:04");
      expect(formatTime(4, e)).toBe("2:01");
    });

    it("is turn n, counting all turns from 1, when the turn has no start", () => {
      expect(formatTime(6, e)).toBe("turn 4");
      expect(formatTime(8, e)).toBe("turn 5");
    });

    it("is the last turn before a tool call", () => {
      expect(formatTime(5, e)).toBe("2:01");
      expect(formatTime(7, e)).toBe("turn 4");
    });

    it("is 0:00 for a tool call before any turn", () => {
      expect(formatTime(1, e)).toBe("0:00");
    });

    it("crosses the minute and hour boundaries without a rollover", () => {
      const long = ev([agent("a", 59.99), agent("b", 60), agent("c", 3725)]);
      expect([1, 2, 3].map((s) => formatTime(s, long))).toEqual(["0:59", "1:00", "62:05"]);
    });
  });
});
