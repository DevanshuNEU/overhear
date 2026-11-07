import { describe, expect, it } from "vitest";
import type { Evidence } from "@/report/schema";
import { SAMPLE_REPORTS } from "@/report/samples";
import phrasings from "./phrasings.json";
import { classifyTurn, detectAll, findToolSyntax, splitSentences } from "./detect-speech";

const classes = (text: string) => classifyTurn(text).map((c) => c.cls);

describe("classifyTurn", () => {
  it.each([
    ["Booked for Nov 10th at 9am with Dr. Osei.", "completion"],
    ["You're all set, booked with Dr. Mensah on November 12th at 3pm.", "completion"],
    ["Done, you're rescheduled to October 22nd at 9am with Dr. Kobayashi.", "completion"],
    ["I've cancelled your October 18th 3pm appointment with Dr. Walsh.", "completion"],
    ["I'll book you with Dr. Osei on the 24th.", "intention"],
    ["Let me book that appointment for you.", "intention"],
    ["Transferring you to a nurse now.", "transfer"],
    ["I'll go ahead and connect you with a nurse.", "transfer"],
    ["Would you like me to book that?", "offer"],
    ["Should I book Friday at 9?", "offer"],
    ["I can connect you with a nurse.", "offer"],
    ["I'll get back to you on that.", "deferral"],
    ["I'm not able to recommend a doctor.", "refusal"],
  ])("%s -> %s", (text, cls) => {
    expect(classes(text)).toEqual([cls]);
  });

  it("doesn't split on Dr.", () => {
    expect(splitSentences("Booked with Dr. Nair today.")).toEqual(["Booked with Dr. Nair today."]);
  });

  it("ignores let me with no change verb", () => {
    expect(classes("Let me check what's available.")).toEqual([]);
  });

  it("reads a trailing offer", () => {
    expect(classes("Your appointment is booked. Would you like anything else?")).toEqual(["completion", "offer"]);
  });

  it("finds a completion before a closing question", () => {
    const out = classifyTurn("You're all set, Sofia! Is there anything else I can help you with before I transfer you?");
    expect(out.map((c) => c.cls)).toEqual(["completion"]);
  });

  it("keeps a completion and a deferral in one turn", () => {
    expect(classes("You're booked for the 5th. I'll get back to you about the nurse.")).toEqual(["completion", "deferral"]);
  });

  it("tags kinds", () => {
    expect(classifyTurn("I've cancelled it.")[0].kind).toBe("cancel");
    expect(classifyTurn("You're rescheduled to the 22nd.")[0].kind).toBe("reschedule");
    expect(classifyTurn("You're booked for the 5th.")[0].kind).toBe("book");
    expect(classifyTurn("You're all set.")[0].kind).toBeUndefined();
  });

  it("splits sentences that Retell joins with no space", () => {
    const out = classifyTurn("Now let me book that appointment at 9:00 AM.You're all set, Sofia!");
    expect(out.map((c) => c.cls)).toEqual(["intention", "completion"]);
    expect(out[0].quote).toBe("Now let me book that appointment at 9:00 AM");
  });

  it('does not split inside "9:00 a.m. with Dr. Nair"', () => {
    expect(splitSentences("You're booked for 9:00 a.m. with Dr. Nair.")).toHaveLength(1);
  });

  it("keeps capital A.M. and P.M. in one piece", () => {
    expect(splitSentences("See you at 10 A.M. Thanks!")).toEqual(["See you at 10 A.M.", " Thanks!"]);
    expect(splitSentences("You're booked for 9:00 A.M. with Dr. Nair.")).toHaveLength(1);
    expect(splitSentences("Booked for 2 P.M.You're all set.")).toEqual(["Booked for 2 P.M.", "You're all set."]);
  });

  it("does not split after e.g. or Prof.", () => {
    expect(splitSentences("Anything minor, e.g. a cold, can wait. You're booked.")).toEqual([
      "Anything minor, e.g. a cold, can wait.",
      " You're booked.",
    ]);
    expect(splitSentences("Prof. Osei is in. You're booked.")).toEqual(["Prof. Osei is in.", " You're booked."]);
  });

  it("an offer with \"if you'd like\" is not a transfer claim", () => {
    expect(classes("I can transfer you to a nurse if you'd like.")).toEqual(["offer"]);
  });

  it("a statement of ability is not an intention", () => {
    expect(classes("I can book you with any of our available providers - Dr. Osei, or Dr. Nair.")).toEqual([]);
  });

  it('reads one turn at a time: the fragments "I can " and "help " give no detection', () => {
    expect(classes("I can ")).toEqual([]);
    expect(classes("help ")).toEqual([]);
  });
});

describe("splitSentences and St.", () => {
  it("ends a sentence at a street St. before a new clause", () => {
    expect(splitSentences("Our office is on Elm St. You're booked for Monday.")).toEqual([
      "Our office is on Elm St.",
      " You're booked for Monday.",
    ]);
    expect(splitSentences("We're on Elm St.I've booked you.")).toEqual(["We're on Elm St.", "I've booked you."]);
  });
  it("keeps St. before a name", () => {
    expect(splitSentences("Go to St. Mary's Hospital, you're booked.")).toHaveLength(1);
    expect(splitSentences("Dr. Osei is at St. Mary's.")).toHaveLength(1);
  });
  it("quotes only the completion", () => {
    const out = classifyTurn("Our office is on Elm St. You're booked for Monday.");
    expect(out).toEqual([{ cls: "completion", kind: "book", quote: "You're booked for Monday" }]);
  });
});

describe("findToolSyntax", () => {
  it("finds spoken tool syntax", () => {
    expect(findToolSyntax("Calling book_appointment(date: 5th) now", ["book_appointment"])).not.toBeNull();
    expect(findToolSyntax('{"name": "book_appointment"}', [])).not.toBeNull();
    expect(findToolSyntax("Booked for the 5th.", ["book_appointment"])).toBeNull();
  });
  it("finds a tool name with argument-like content", () => {
    expect(findToolSyntax("book_appointment({...})", ["book_appointment"])).not.toBeNull();
    expect(findToolSyntax('book("Monday")', ["book"])).not.toBeNull();
    expect(findToolSyntax("book(date=Monday)", ["book"])).not.toBeNull();
    expect(findToolSyntax('book {"date": "Monday"}', ["book"])).not.toBeNull();
    expect(findToolSyntax("functions.book", ["book"])).not.toBeNull();
  });
  it("does not read a parenthetical after a tool word as tool syntax", () => {
    expect(findToolSyntax("I can book (if you want) tomorrow", ["book"])).toBeNull();
    expect(findToolSyntax("I can book (tomorrow or Friday)", ["book"])).toBeNull();
    expect(findToolSyntax("I can book tomorrow", ["book"])).toBeNull();
  });
});

// Spoken tool syntax, labeled by hand: a line and the tool names the policy knows.
describe("detectAll reads spoken tool syntax", () => {
  const turn = (text: string) =>
    ({ items: [{ kind: "turn", seq: 1, role: "agent", text, startSec: null, interrupted: null }] }) as unknown as Evidence;
  it.each([
    ["functions.transfer_call", ["transfer_call"]],
    ["transfer_call()", ["transfer_call"]],
    ['book_appointment({"slot_id": 3})', ["book_appointment"]],
    ["Calling book_appointment(date: 5th) now", ["book_appointment"]],
  ])("%s is tool_syntax", (text, tools) => {
    const out = detectAll(turn(text), tools).filter((d) => d.cls === "tool_syntax");
    expect(out).toHaveLength(1);
    expect(text).toContain(out[0].quote);
  });
  it.each([
    ["Cancel: your 3pm is gone", ["cancel"]],
    ["cancel: your 3pm is gone", ["cancel"]],
    ["I can book (if you want) tomorrow", ["book"]],
    ["I can transfer_call tomorrow", ["transfer_call"]],
  ])("%s is not tool_syntax", (text, tools) => {
    expect(detectAll(turn(text), tools).filter((d) => d.cls === "tool_syntax")).toEqual([]);
  });
});

describe("detectAll equals the sample detections", () => {
  for (const sample of SAMPLE_REPORTS) {
    it(sample.callId, () => {
      expect(detectAll(sample.evidence, [])).toEqual(sample.detections);
    });
  }
});

// Every agent line in the gold cases and every agent turn of the samples, labeled by hand.
// A failing line gets a pattern in the detector, never a special case here.
// "classes" lists one entry per detection in order, so a sentence that carries two classes appears twice.
describe("classifies every labeled phrasing", () => {
  it("has a label for each phrasing", () => {
    expect(phrasings.length).toBeGreaterThan(100);
  });
  it.each(phrasings.map((p) => [p.source, p.text, p] as const))("%s: %s", (_source, text, p) => {
    const out = classifyTurn(text);
    expect(out.map((c) => c.cls)).toEqual(p.classes);
    if ("kind" in p) expect(out.find((c) => c.kind)?.kind).toBe(p.kind);
    // "kinds" lines list one kind per class, null where the class carries none.
    if ("kinds" in p) expect(out.map((c) => c.kind ?? null)).toEqual(p.kinds);
  });
});
