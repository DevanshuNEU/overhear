// @vitest-environment node
// spoken_format: a year read aloud for a date this close, and a date or time read in computer format.
import { describe, expect, it } from "vitest";
import { ExperienceProblemSchema, type Evidence } from "@/report/schema";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { loadCases } from "../../../scripts/engine-evals/io";
import { analyzeRetellCall } from "../analyze";
import { ev, type ItemSpec } from "../testing/build";
import { spokenFormat } from "./spoken-format";

const agent = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "agent", text, startSec, interrupted: null });
const caller = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "caller", text, startSec, interrupted: null });

const NOV_5 = Date.parse("2026-11-05T15:00:00Z"); // Thursday 10:00 in New York
const NY = "America/New_York";

/** The check on a call that started at `start`, read in `tz`. */
const run = (items: ItemSpec[], start: number | null = NOV_5, tz = NY) => spokenFormat(ev(items, { callStartMs: start }), { detections: [], tz });
const texts = (items: ItemSpec[], start: number | null = NOV_5, tz = NY) => run(items, start, tz).problems.map((p) => p.text);

describe("year read aloud for a near date", () => {
  it("flags a full date with its year on the day after tomorrow's call, quoting it as said", () => {
    const out = run([agent("Should I book Friday, November 6, 2026, at 9:00 a.m.?", 12)]);
    expect(out.ran).toBe(true);
    expect(out.problems).toEqual([
      { check: "spoken_format", text: 'At 0:12 the agent read the year aloud for a date this close: "Friday, November 6, 2026".', seqs: [1] },
    ]);
    for (const p of out.problems) expect(ExperienceProblemSchema.safeParse(p).success).toBe(true);
  });

  it("does not flag the same sentence without the year", () => {
    expect(run([agent("Should I book Friday, November 6, at 9:00 a.m.?")])).toEqual({ ran: true, problems: [] });
  });

  it("does not flag a date of birth read back", () => {
    expect(run([agent("Just to confirm, you were born March 14, 1985?")])).toEqual({ ran: true, problems: [] });
    expect(run([agent("Your date of birth is March 14, 1985, correct?")])).toEqual({ ran: true, problems: [] });
  });

  it("does not flag a near date said after born or birth", () => {
    expect(run([agent("So the baby was born November 20, 2026?")])).toEqual({ ran: true, problems: [] });
    expect(run([agent("Is the date of birth November 20, 2026?")])).toEqual({ ran: true, problems: [] });
  });

  it("does not flag a near date when birth is named after it", () => {
    expect(run([agent("Is November 20, 2026 the baby's date of birth?")])).toEqual({ ran: true, problems: [] });
    expect(run([agent("Is November 8, 2026 their birthday?")])).toEqual({ ran: true, problems: [] });
    // Past the sentence or 40 characters, birth is about something else.
    expect(texts([agent("Is November 20, 2026 good for you? Also, what is the baby's date of birth?")])).toHaveLength(1);
    expect(texts([agent("Is November 20, 2026 good for you, since the family lives far away from the clinic and the baby's birth was recent?")])).toHaveLength(1);
  });

  it("does not flag a date more than 180 days from the call", () => {
    expect(run([agent("Your last visit was on March 3, 2026.")]).problems).toEqual([]);
    expect(run([agent("How about May 3, 2026?")]).problems).toEqual([]);
  });

  it("flags a date 0 to 180 days after the call and not 181 (call on Jan 10, 2026)", () => {
    const jan10 = Date.parse("2026-01-10T15:00:00Z");
    expect(texts([agent("January 10, 2026")], jan10, "UTC")).toHaveLength(1); // the same day
    expect(texts([agent("July 9, 2026")], jan10, "UTC")).toHaveLength(1); // 180 days after
    expect(texts([agent("July 10, 2026")], jan10, "UTC")).toEqual([]); // 181 days after
  });

  it("does not flag a past date: a record read back is normal speech", () => {
    expect(texts([agent("Your last visit was on September 10, 2026.")])).toEqual([]);
    expect(texts([agent("Your last visit was on November 4, 2026.")])).toEqual([]); // the day before
    const jul10 = Date.parse("2026-07-10T15:00:00Z");
    expect(texts([agent("January 11, 2026")], jul10, "UTC")).toEqual([]); // 180 days before
  });

  it("flags the call's own day when the year is read", () => {
    expect(texts([agent("That is today, November 5, 2026.")])).toHaveLength(1);
  });

  it("does not flag the year for a date in the next calendar year: it is helpful there", () => {
    const lateDec = Date.parse("2026-12-28T15:00:00Z");
    expect(texts([agent("I can do January 5, 2027.")], lateDec, "UTC")).toEqual([]);
    expect(texts([agent("I can do December 30, 2026.")], lateDec, "UTC")).toHaveLength(1);
  });

  it("does not flag the year for a date in the previous calendar year", () => {
    const earlyJan = Date.parse("2027-01-03T15:00:00Z");
    expect(texts([agent("Your last visit was December 30, 2026.")], earlyJan, "UTC")).toEqual([]);
  });

  it("reads the calendar year in the report's zone", () => {
    const nye = Date.parse("2027-01-01T04:30:00Z"); // Dec 31, 2026 in New York, Jan 1, 2027 in UTC
    expect(texts([agent("Your visit is December 31, 2026.")], nye, "UTC")).toEqual([]);
    expect(texts([agent("Your visit is December 31, 2026.")], nye, NY)).toHaveLength(1);
  });

  it("skips the year rule without the call's start but still runs", () => {
    expect(run([agent("Should I book Friday, November 6, 2026?")], null)).toEqual({ ran: true, problems: [] });
  });

  it("is one problem for a turn, listing each date said", () => {
    const out = run([agent("Is it November 6, 2026 or November 9, 2026?", 4)]);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0].text).toBe('At 0:04 the agent read the year aloud for a date this close: "November 6, 2026" and "November 9, 2026".');
  });

  it("groups several turns into one problem citing each, quoting the first date said", () => {
    const out = run([
      agent("Earliest is Friday, November 6, 2026, at 9:00 a.m.", 40),
      caller("Fine."),
      agent("Should I book November 6, 2026?", 79),
      agent("You're booked for Friday, November 6, 2026.", 107),
    ]);
    expect(out.problems).toEqual([
      {
        check: "spoken_format",
        text: 'The agent read the year aloud for a date this close 3 times (at 0:40, 1:19 and 1:47), for example "Friday, November 6, 2026".',
        seqs: [1, 3, 4],
      },
    ]);
    for (const p of out.problems) expect(ExperienceProblemSchema.safeParse(p).success).toBe(true);
  });

  it("groups two turns with the list helper's wording, and counts only turns that flagged", () => {
    const out = run([agent("It is November 6, 2026.", 5), agent("Anything else?", 8), agent("See you November 9, 2026.", 12)]);
    expect(out.problems.map((p) => p.text)).toEqual(['The agent read the year aloud for a date this close 2 times (at 0:05 and 0:12), for example "November 6, 2026".']);
    expect(out.problems[0].seqs).toEqual([1, 3]);
  });

  it("cites the turn, not the caller", () => {
    const out = run([caller("Is it November 6, 2026?"), agent("Yes, November 6, 2026.")]);
    expect(out.problems.map((p) => p.seqs)).toEqual([[2]]);
  });
});

describe("computer formats", () => {
  it("flags an ISO date", () => {
    expect(run([agent("You are booked for 2026-11-06.", 7)]).problems).toEqual([
      { check: "spoken_format", text: 'At 0:07 the agent read a date or time in computer format: "2026-11-06".', seqs: [1] },
    ]);
  });

  it("flags an ISO timestamp as one quote", () => {
    expect(texts([agent("That is 2026-11-06T15:00:00Z.", 3)])).toEqual(['At 0:03 the agent read a date or time in computer format: "2026-11-06T15:00:00Z".']);
    expect(texts([agent("That is 2026-11-06T15:00:00-05:00 for you.", 3)])).toEqual(['At 0:03 the agent read a date or time in computer format: "2026-11-06T15:00:00-05:00".']);
  });

  it("flags a 24-hour time with a colon after 12", () => {
    expect(texts([agent("How about 15:00?", 9)])).toEqual(['At 0:09 the agent read a date or time in computer format: "15:00".']);
    expect(texts([agent("The slot is 23:45.")])).toHaveLength(1);
    expect(texts([agent("The slot is 13:05:00.")])).toEqual(['At turn 1 the agent read a date or time in computer format: "13:05:00".']);
  });

  it("does not flag a time said the usual way", () => {
    for (const said of ["3:00 PM", "3:00 p.m.", "9:00 a.m.", "12:30", "12:00 noon", "11:59", "10:15 in the morning", "13:00 pm"]) {
      expect(texts([agent(`See you at ${said}.`)]), said).toEqual([]);
    }
  });

  it("flags an ISO date only with a 19xx or 20xx year, not after a word character", () => {
    for (const said of ["Your confirmation code is 4821-10-12.", "Your id is 0207-12-30.", "Order AB2026-11-06 is ready.", "Code x-2026-11-06."]) {
      expect(texts([agent(said)]), said).toEqual([]);
    }
    expect(texts([agent("Booked for 2026-11-06.")])).toHaveLength(1);
    expect(texts([agent("Booked for 1999-12-31.")])).toHaveLength(1);
  });

  it("does not flag numbers that only look like a time or a date", () => {
    for (const said of ["Your code is 1234-56-78.", "The ratio is 16:9 on that screen.", "Call 555-0142.", "It costs 2026-11 dollars."]) {
      expect(texts([agent(said)]), said).toEqual([]);
    }
  });

  it("flags computer formats with no call start", () => {
    expect(run([agent("You are booked for 2026-11-06 at 15:00.")], null)).toEqual({
      ran: true,
      problems: [{ check: "spoken_format", text: 'At turn 1 the agent read a date or time in computer format: "2026-11-06" and "15:00".', seqs: [1] }],
    });
  });

  it("groups several turns into one problem citing each, quoting the first fragment said", () => {
    const out = run([agent("You are booked for 2026-11-06.", 40), agent("Fine.", 50), agent("That is 15:00 on 2026-11-06.", 79), agent("Again, 2026-11-06T15:00:00Z.", 107)]);
    expect(out.problems).toEqual([
      {
        check: "spoken_format",
        text: 'The agent read a date or time in computer format 3 times (at 0:40, 1:19 and 1:47), for example "2026-11-06".',
        seqs: [1, 3, 4],
      },
    ]);
  });

  it("groups two turns with the list helper's wording", () => {
    const out = run([agent("How about 15:00?", 9), agent("Or 16:30?", 14)]);
    expect(out.problems.map((p) => p.text)).toEqual(['The agent read a date or time in computer format 2 times (at 0:09 and 0:14), for example "15:00".']);
    expect(out.problems[0].seqs).toEqual([1, 2]);
  });

  it("is one problem for a turn, listing each fragment once", () => {
    const out = run([agent("2026-11-06 at 15:00, again 2026-11-06 at 15:00.")]);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0].text).toBe('At turn 1 the agent read a date or time in computer format: "2026-11-06" and "15:00".');
  });

  it("flags a date with a year and a computer format in one turn as two problems", () => {
    const out = run([agent("November 6, 2026 is 2026-11-06.", 2)]);
    expect(out.problems.map((p) => p.text)).toEqual([
      'At 0:02 the agent read the year aloud for a date this close: "November 6, 2026".',
      'At 0:02 the agent read a date or time in computer format: "2026-11-06".',
    ]);
    expect(out.problems.map((p) => p.seqs)).toEqual([[1], [1]]);
  });

  it("does not read the caller's words", () => {
    expect(run([caller("It was 2026-11-06 at 15:00, November 6, 2026"), agent("Thanks.")]).problems).toEqual([]);
  });
});

describe("whether it ran", () => {
  it("runs on any call with an agent turn, with or without a call start", () => {
    expect(run([agent("Hello.")]).ran).toBe(true);
    expect(run([agent("Hello.")], null).ran).toBe(true);
  });

  it("does not run on a call with no agent turn", () => {
    expect(run([caller("Hello?")])).toEqual({ ran: false, problems: [] });
    expect(run([])).toEqual({ ran: false, problems: [] });
  });
});

describe("quotes", () => {
  const reportsToCheck = () => [
    ...loadCases().flatMap((c) => {
      const out = analyzeRetellCall(c.record, { tz: c.tz ?? "UTC" });
      return out.kind === "report" ? [out.report] : [];
    }),
    failedSample,
    needsReviewSample,
    passedSample,
  ];
  const QUOTE = /(?:: |for example )("[^"]+"(?:, "[^"]+")*(?: and "[^"]+")?)\.$/;
  const quotesOf = (text: string): string[] => [...(QUOTE.exec(text)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);

  it("reads quotes back from the list wording", () => {
    expect(quotesOf('At 0:03 the agent read a date or time in computer format: "a" and "b".')).toEqual(["a", "b"]);
    expect(quotesOf('At 0:03 the agent read the year aloud for a date this close: "a".')).toEqual(["a"]);
    expect(quotesOf('The agent read a date or time in computer format 2 times (at 0:03 and 0:09), for example "a".')).toEqual(["a"]);
  });

  it("every quote is a verbatim substring of the turn it cites, on every sample and eval case", () => {
    let checked = 0;
    for (const r of reportsToCheck()) {
      for (const p of r.experience.problems.filter((q) => q.check === "spoken_format")) {
        const turn = r.evidence.items.find((it) => it.seq === p.seqs[0]);
        expect(turn?.kind).toBe("turn");
        if (turn?.kind !== "turn") continue;
        expect(turn.role).toBe("agent");
        for (const seq of p.seqs) expect(r.evidence.items.find((it) => it.seq === seq)).toMatchObject({ kind: "turn", role: "agent" });
        const quotes = quotesOf(p.text);
        expect(quotes.length, p.text).toBeGreaterThan(0);
        for (const q of quotes) expect(turn.text, `quote ${JSON.stringify(q)} of ${r.callId}`).toContain(q);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("every quote is verbatim when the check runs on each agent turn of every sample and eval case at a call start near its dates", () => {
    const starts = [Date.parse("2026-11-05T15:00:00Z"), Date.parse("2026-07-01T15:00:00Z"), Date.parse("2026-01-15T15:00:00Z")];
    for (const r of reportsToCheck()) {
      for (const callStartMs of starts) {
        const e: Evidence = { ...r.evidence, callStartMs };
        for (const p of spokenFormat(e, { detections: [], tz: "UTC" }).problems) {
          const turn = e.items.find((it) => it.seq === p.seqs[0]);
          if (turn?.kind !== "turn") throw new Error("a problem must cite a turn");
          for (const q of quotesOf(p.text)) expect(turn.text).toContain(q);
        }
      }
    }
  });
});
