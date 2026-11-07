// @vitest-environment node
// Spoken dates, times and field matching. The first block is the old plan's Task 7 table, carried over word for
// word (a call on Monday 2026-11-02, zone America/New_York). The blocks after it pin the conservative rules: a
// value that is only unparsed, unresolvable or scrubbed never makes a field "differs".
import { describe, expect, it } from "vitest";
import { fieldCheck, formatValue, matchField, matchReadings, parseSpokenDateTimes, spokenValues, toLocal } from "./spoken";

const call = Date.parse("2026-11-02T15:00:00Z"); // Monday, 10:00 in New York
const ny = "America/New_York";
const ctx = { callStartMs: call, tz: ny, policyTz: false, otherNames: [] as string[] };

describe("the old plan's Task 7 table", () => {
  it.each([
    ["Thursday the 5th at 9 a.m.", [{ date: "2026-11-05", time: "09:00", ampm: true }]],
    ["you're booked for the 24th", [{ date: "2026-11-24", ampm: false }]],
    ["tomorrow at 3:30 PM", [{ date: "2026-11-03", time: "15:30", ampm: true }]],
    ["November 4th at noon", [{ date: "2026-11-04", time: "12:00", ampm: true }]],
    ["next Tuesday at quarter past ten in the morning", [{ date: "2026-11-10", time: "10:15", ampm: true }]],
  ])("parses %s", (text, want) => expect(parseSpokenDateTimes(text, call, ny)).toEqual(want));
  it("rolls a past day-of-month into next month", () => expect(parseSpokenDateTimes("the 1st", call, ny)[0].date).toBe("2026-12-01"));
  it("compares a late-evening slot stored as next-day UTC", () => expect(toLocal("2026-11-05T04:30:00.000Z", ny, false)).toEqual({ date: "2026-11-04", time: "23:30" }));
  it("uses the summer offset", () => expect(toLocal("2026-07-01T13:00:00Z", ny, false).time).toBe("09:00"));
  it("prints midnight as 00", () => expect(toLocal("2026-11-05T05:15:00Z", ny, false).time).toBe("00:15"));
  it("never shifts a date-only value", () => expect(toLocal("2026-11-05", ny, false)).toEqual({ date: "2026-11-05" }));
  it("reads a non-zero offset in its own zone without a policy", () => expect(toLocal("2026-11-05T09:00:00-08:00", ny, false).time).toBe("09:00"));
  it("matches a bare hour against the afternoon slot", () => expect(matchField("time", "Thursday at 3", "2026-11-05T20:00:00Z", ctx)).toBe("match"));
  it("matches when any spoken value matches", () => expect(matchField("date", "I moved you from the 3rd to the 5th", "2026-11-05T14:00:00Z", ctx)).toBe("match"));
  it("differs only when the type was spoken and nothing matches", () => expect(matchField("date", "booked for the 6th", "2026-11-05T14:00:00Z", ctx)).toBe("differs"));
  it("matches provider surnames, ignoring titles", () => {
    expect(matchField("name", "with Dr. Nair", "Dr. Priya Nair", ctx)).toBe("match");
    expect(matchField("name", "with Dr. Okafor", "Dr. Priya Nair", { ...ctx, otherNames: ["Dr. James Okafor"] })).toBe("differs");
    expect(matchField("name", "you're all set", "Dr. Priya Nair", ctx)).toBe("not_spoken");
  });
  it("compares ids case-insensitively", () => expect(matchField("id", "order AB12", "ab12", ctx)).toBe("match"));
  it("formats a date-only value without shifting it", () => expect(formatValue("date", "2026-11-05", ny)).toBe("Thursday, November 5"));
  it("returns spoken values for display", () => expect(spokenValues("time", "booked for 3:30 PM", ctx)).toEqual(["3:30 PM"]));
  it("keeps month and day when callStartMs is null", () => expect(parseSpokenDateTimes("May 16th", null, ny)).toEqual([{ monthDay: "05-16", ampm: false }]));
  it("matches a month-day against a full committed date", () => expect(matchField("date", "May 16th", "2024-05-16", { ...ctx, callStartMs: null })).toBe("match"));
});

// OVE-49: with no policy zone a committed value has more than one plausible reading. matchReadings gives the result
// in each, the first being the check's own reading (the one matchField reports).
describe("matchReadings: the zones a committed value may be read in (OVE-49)", () => {
  const utcSlot = "2026-11-13T19:00:00Z"; // 2 PM in New York
  const statuses = (...args: Parameters<typeof matchReadings>) => matchReadings(...args).map((r) => [r.where, r.status]);
  it("reads UTC wall time as a second plausible zone without a policy zone", () => {
    expect(statuses("time", "at 7 PM", utcSlot, ctx)).toEqual([["here", "differs"], ["utc", "match"]]);
    expect(statuses("time", "at 2 PM", utcSlot, ctx)).toEqual([["here", "match"], ["utc", "differs"]]);
    expect(statuses("time", "at 4 PM", utcSlot, ctx)).toEqual([["here", "differs"], ["utc", "differs"]]);
    expect(matchField("time", "at 7 PM", utcSlot, ctx)).toBe("differs");
  });
  it("never offers a second zone for a policy's zone", () => expect(matchReadings("time", "at 7 PM", utcSlot, { ...ctx, policyTz: true })).toHaveLength(1));
  it("compares the date and time as a pair in each zone, never one from each", () => {
    // 8 PM on the 13th in New York is 1 AM on the 14th in UTC.
    const late = "2026-11-14T01:00:00Z";
    expect(statuses("datetime", "Friday, November 13 at 1 AM", late, ctx)).toEqual([["here", "differs"], ["utc", "differs"]]);
    expect(statuses("datetime", "Saturday, November 14 at 1 AM", late, ctx)).toEqual([["here", "differs"], ["utc", "match"]]);
    expect(statuses("datetime", "Friday, November 13 at 8 PM", late, ctx)).toEqual([["here", "match"], ["utc", "differs"]]);
  });
  it("reads a slot's own offset as written, and the machine's zone as the other reading", () => {
    const own = "2026-11-13T14:00:00-05:00";
    const london = { ...ctx, tz: "Europe/London" };
    expect(statuses("time", "at 2 PM", own, london)).toEqual([["offset", "match"], ["here", "differs"]]);
    expect(statuses("time", "at 7 PM", own, london)).toEqual([["offset", "differs"], ["here", "match"]]);
    expect(statuses("time", "at 4 PM", own, london)).toEqual([["offset", "differs"], ["here", "differs"]]);
  });
  it("has one reading when both zones agree, or for a value with no offset, or a date alone", () => {
    expect(matchReadings("time", "at 4 PM", utcSlot, { ...ctx, tz: "UTC" })).toHaveLength(1);
    expect(matchReadings("time", "at 4 PM", "2026-11-13T14:00:00", ctx)).toHaveLength(1);
    expect(matchReadings("date", "the 14th", "2026-11-13", ctx)).toHaveLength(1);
  });
  it("shows the value as each reading has it", () => {
    expect(matchReadings("time", "at 7 PM", utcSlot, ctx).map((r) => r.shown)).toEqual(["2:00 PM", "7:00 PM"]);
  });
  // "Today" is counted in each reading's own zone, not the machine's.
  it("counts the call's day in the zone of each reading", () => {
    const lateCall = { ...ctx, callStartMs: Date.parse("2026-11-13T02:00:00Z") }; // Nov 12, 9 PM in New York
    expect(statuses("datetime", "tomorrow at 10 AM", "2026-11-14T10:00:00Z", lateCall)).toEqual([["here", "differs"], ["utc", "match"]]);
    expect(statuses("datetime", "today at 7 PM", "2026-11-13T19:00:00Z", lateCall)).toEqual([["here", "differs"], ["utc", "match"]]);
  });
  it("counts the call's day in the slot's own offset by hand", () => {
    // 2026-11-13T02:00Z is Nov 12 at 9 PM in -05:00, so "today" is the 12th there.
    const lateCall = { ...ctx, tz: "Asia/Tokyo", callStartMs: Date.parse("2026-11-13T02:00:00Z") };
    expect(statuses("datetime", "today at 3 PM", "2026-11-12T15:00:00-05:00", lateCall)[0]).toEqual(["offset", "match"]);
  });
});

describe("placeholders", () => {
  it("a placeholder committed value is reported as unresolved, never differs", () => {
    expect(matchField("name", "with Dr. Nair", "[person name 1]", ctx)).toBe("not_spoken");
    expect(fieldCheck("provider", "name", "with Dr. Nair", "[person name 1]", ctx)).toEqual({
      field: "provider",
      type: "name",
      from: "spoken",
      values: ["Dr. Nair"],
      committed: null,
      status: "unresolved",
    });
    for (const value of ["[email 1]", "[date_of_birth_1]"]) {
      expect(fieldCheck("date", "date", "booked for the 6th", value, ctx).status).toBe("unresolved");
    }
  });

  it("a placeholder in the spoken words never makes a differing value", () => {
    expect(matchField("name", "with Dr. Okafor and [person name 1]", "Dr. Priya Nair", { ...ctx, otherNames: ["Dr. James Okafor"] })).toBe("not_spoken");
    expect(matchField("date", "booked for the 6th, [date 1]", "2026-11-05", ctx)).toBe("not_spoken");
  });
});

describe("parsing", () => {
  it.each([
    ["at midnight", [{ time: "00:00", ampm: true }]],
    ["at 12 a.m.", [{ time: "00:00", ampm: true }]],
    ["at 12 p.m.", [{ time: "12:00", ampm: true }]],
    ["at half past two in the afternoon", [{ time: "14:30", ampm: true }]],
    ["at quarter to five", [{ time: "04:45", ampm: false }]],
    ["at 15:30", [{ time: "15:30", ampm: true }]],
    ["at three thirty p.m.", [{ time: "15:30", ampm: true }]],
    ["at 3 o'clock", [{ time: "03:00", ampm: false }]],
    ["at seven tonight", [{ time: "19:00", ampm: true }]],
    ["Friday, November 6, 2026, at 2:00 p.m.", [{ date: "2026-11-06", time: "14:00", ampm: true }]],
    ["the twenty-fourth of November", [{ date: "2026-11-24", ampm: false }]],
    ["Thursday", [{ date: "2026-11-05", ampm: false }]],
    ["booked for today at 4 PM", [{ date: "2026-11-02", time: "16:00", ampm: true }]],
  ])("parses %s", (text, want) => expect(parseSpokenDateTimes(text, call, ny)).toEqual(want));

  it("reads every value in a turn, in order", () => {
    expect(parseSpokenDateTimes("I moved you from Tuesday at 2 p.m. to Thursday at 9 a.m.", call, ny)).toEqual([
      { date: "2026-11-03", time: "14:00", ampm: true },
      { date: "2026-11-05", time: "09:00", ampm: true },
    ]);
  });

  it("reads a month and day in a later year when it has passed", () => {
    expect(parseSpokenDateTimes("May 16th", call, ny)).toEqual([{ date: "2027-05-16", ampm: false }]);
  });

  it("uses the call's own date in the zone, not the UTC date", () => {
    // 02:00 UTC on Tuesday is still Monday evening in New York.
    expect(parseSpokenDateTimes("booked for tomorrow", Date.parse("2026-11-03T02:00:00Z"), ny)).toEqual([{ date: "2026-11-03", ampm: false }]);
  });

  it("skips relative dates with no call start", () => {
    expect(parseSpokenDateTimes("tomorrow at 3 PM", null, ny)).toEqual([{ time: "15:00", ampm: true }]);
  });

  it.each([
    "How can I help you today?",
    "You may need your insurance card.",
    "We're open Monday through Friday.",
    "Let me find the first available slot.",
    "I have 3 openings.",
  ])("reads no date or time in %j", (text) => {
    expect(parseSpokenDateTimes(text, call, ny)).toEqual([]);
  });
});

describe("toLocal", () => {
  it("reads +00:00 like Z, in the zone", () => expect(toLocal("2026-11-05T14:00:00+00:00", ny, false)).toEqual({ date: "2026-11-05", time: "09:00" }));
  it("reads an offset value in the policy zone when there is one", () => expect(toLocal("2026-11-05T09:00:00-08:00", ny, true).time).toBe("12:00"));
  it("uses the winter offset after the clocks go back", () => expect(toLocal("2026-11-02T14:00:00Z", ny, false).time).toBe("09:00"));
  it("never shifts a time-only value", () => expect(toLocal("15:00", ny, true)).toEqual({ time: "15:00" }));
  it("never shifts a datetime with no offset", () => expect(toLocal("2026-11-05T09:00:00", ny, true)).toEqual({ date: "2026-11-05", time: "09:00" }));
  it("gives nothing for a value it cannot read", () => {
    expect(toLocal("next week", ny, false)).toEqual({});
    expect(toLocal("2026-11-05T14:00:00Z", "Mars/Base", false)).toEqual({});
  });
});

describe("matchField: conservative", () => {
  it("a.m. and p.m. are compared exactly", () => {
    expect(matchField("time", "at 3 a.m.", "2026-11-05T20:00:00Z", ctx)).toBe("differs");
    expect(matchField("time", "at 3 p.m.", "2026-11-05T20:00:00Z", ctx)).toBe("match");
  });

  it("a bare hour still differs when the hour is wrong", () => {
    expect(matchField("time", "Thursday at 4", "2026-11-05T20:00:00Z", ctx)).toBe("differs");
  });

  it("an unparsed time-like word blocks differs", () => {
    expect(matchField("time", "between 2 p.m. and 4", "2026-11-05T21:00:00Z", ctx)).toBe("not_spoken");
  });

  it("an unparsed date-like word blocks differs", () => {
    expect(matchField("date", "the 6th or the first available", "2026-11-05", ctx)).toBe("not_spoken");
    expect(matchField("date", "the 6th, Monday through Friday", "2026-11-05", ctx)).toBe("not_spoken");
  });

  it("a weekday shifted by words it does not count is never compared", () => {
    expect(matchField("date", "Your appointment is a week from Thursday.", "2026-11-12", ctx)).toBe("not_spoken");
    expect(matchField("date", "You're booked for Thursday after next.", "2026-11-12", ctx)).toBe("not_spoken");
  });

  it("reads both weekdays of a move, but not a range of opening days", () => {
    expect(matchField("date", "I've moved you from Wednesday to Thursday.", "2026-11-05", ctx)).toBe("match");
    expect(matchField("date", "I've moved you from Wednesday to Thursday.", "2026-11-06", ctx)).toBe("differs");
    expect(matchField("date", "We're open Monday to Friday. You're booked for the 6th.", "2026-11-05", ctx)).toBe("not_spoken");
  });

  it("a number before an address or a count is not an hour", () => {
    expect(parseSpokenDateTimes("We're at 5 Elm Street.", call, ny)).toEqual([]);
    expect(matchField("time", "See you Thursday at our office at 5 Elm Street.", "2026-11-05T20:00:00Z", ctx)).toBe("not_spoken");
    expect(matchField("time", "We have doctors at 2 locations.", "2026-11-05T20:00:00Z", ctx)).toBe("not_spoken");
    expect(matchField("time", "Thursday at 3 at 5 Elm Street.", "2026-11-05T20:00:00Z", ctx)).toBe("match");
  });

  it("hours joined by to are a range, not a time", () => {
    expect(parseSpokenDateTimes("We're open from ten to five.", call, ny)).toEqual([]);
    expect(matchField("time", "We're open from ten to five, and you're booked at 4 PM.", "2026-11-05T20:00:00Z", ctx)).toBe("not_spoken");
    expect(parseSpokenDateTimes("at twenty past three", call, ny)).toEqual([{ time: "03:20", ampm: false }]);
    expect(parseSpokenDateTimes("at ten minutes to five", call, ny)).toEqual([{ time: "04:50", ampm: false }]);
  });

  it("a stray tomorrow blocks a differing date, a small-talk today does not", () => {
    expect(matchField("date", "You're booked for the 6th. See you tomorrow!", "2026-11-05", ctx)).toBe("not_spoken");
    expect(matchField("date", "You're booked for the 6th. Anything else today?", "2026-11-05", ctx)).toBe("differs");
  });

  it("a first name and another provider's name together never differ", () => {
    expect(matchField("name", "with Priya, not Dr. Okafor", "Dr. Priya Nair", { ...ctx, otherNames: ["Dr. James Okafor"] })).toBe("not_spoken");
  });

  it("a time in a named zone never differs", () => {
    expect(matchField("time", "at 3 PM Pacific", "2026-11-05T20:00:00Z", ctx)).toBe("match");
    expect(matchField("time", "at 4 PM Pacific", "2026-11-05T20:00:00Z", ctx)).toBe("not_spoken");
  });

  it("an abbreviated or slashed date blocks differs", () => {
    expect(matchField("date", "the 6th, I mean Thurs", "2026-11-05", ctx)).toBe("not_spoken");
    expect(matchField("date", "the 6th, I mean 11/5", "2026-11-05", ctx)).toBe("not_spoken");
  });

  it("a relative date with no call start is never compared", () => {
    expect(matchField("date", "booked for tomorrow", "2026-11-05", { ...ctx, callStartMs: null })).toBe("not_spoken");
  });

  it("today in a closing question is not a date", () => {
    expect(matchField("date", "You're all set. Anything else I can help you with today?", "2026-11-05", ctx)).toBe("not_spoken");
  });

  it("next weekday also matches the nearest one", () => {
    expect(matchField("date", "next Tuesday", "2026-11-03", ctx)).toBe("match");
    expect(matchField("date", "next Tuesday", "2026-11-10", ctx)).toBe("match");
    expect(matchField("date", "next Tuesday", "2026-11-17", ctx)).toBe("differs");
  });

  it("a weekday that is the call's own weekday also matches the call date", () => {
    expect(matchField("date", "Monday at 4", "2026-11-02", ctx)).toBe("match");
    expect(matchField("date", "Monday at 4", "2026-11-09", ctx)).toBe("match");
  });

  it("a weekday and a day number that disagree match either reading", () => {
    // The 5th is a Thursday; the agent said Friday.
    expect(matchField("date", "Friday the 5th", "2026-11-05", ctx)).toBe("match");
    expect(matchField("date", "Friday the 5th", "2026-11-06", ctx)).toBe("match");
    expect(matchField("date", "Friday the 5th", "2026-11-07", ctx)).toBe("differs");
  });

  it("compares only the parts of a date that were spoken", () => {
    // No month spoken: the 24th matches the 24th of any month.
    expect(matchField("date", "booked for the 24th", "2026-12-24", ctx)).toBe("match");
    // No year spoken: a month and day match in any year.
    expect(matchField("date", "November 5th", "2027-11-05", ctx)).toBe("match");
    expect(matchField("date", "November 5th, 2026", "2027-11-05", ctx)).toBe("differs");
  });

  it("a committed value it cannot read is not compared", () => {
    expect(matchField("date", "booked for the 6th", "sometime next week", ctx)).toBe("not_spoken");
    expect(matchField("time", "at 3 PM", "2026-11-05", ctx)).toBe("not_spoken");
    expect(matchField("date", "booked for the 6th", null, ctx)).toBe("not_spoken");
    expect(matchField("date", "booked for the 6th", 1793911370896, ctx)).toBe("not_spoken");
  });

  it("an invalid zone is never a differing value", () => {
    expect(matchField("time", "at 3 a.m.", "2026-11-05T20:00:00Z", { ...ctx, tz: "Mars/Base" })).toBe("not_spoken");
  });

  it("matches a datetime when its date and time were both spoken", () => {
    expect(matchField("datetime", "Thursday at 3", "2026-11-05T20:00:00Z", ctx)).toBe("match");
    expect(matchField("datetime", "Thursday at 4", "2026-11-05T20:00:00Z", ctx)).toBe("differs");
    expect(matchField("datetime", "Wednesday at 3", "2026-11-05T20:00:00Z", ctx)).toBe("differs");
    expect(matchField("datetime", "at 3", "2026-11-05T20:00:00Z", ctx)).toBe("not_spoken");
  });

  it("a name needs a title or first name before a different surname to differ", () => {
    const others = { ...ctx, otherNames: ["Dr. James May"] };
    expect(matchField("name", "You may arrive early.", "Dr. Priya Nair", others)).toBe("not_spoken");
    expect(matchField("name", "with James May", "Dr. Priya Nair", others)).toBe("differs");
    expect(matchField("name", "with Priya", "Dr. Priya Nair", ctx)).toBe("match");
  });

  it.each([
    ["string", "your reason is ear pain", "Ear pain", "match"],
    ["string", "your reason is a checkup", "Ear pain", "not_spoken"],
    ["number", "a party of 4", 4, "match"],
    ["number", "a party of 5", 4, "not_spoken"],
    ["money", "that comes to $25.00", "25", "match"],
    ["money", "that comes to 30 dollars", 25, "not_spoken"],
    ["id", "order ZZ99", "ab12", "not_spoken"],
    ["id", "order A B 1 2", "AB12", "match"],
  ] as const)("%s never differs: %j against %j", (type, text, committed, want) => {
    expect(matchField(type, text, committed, ctx)).toBe(want);
  });
});

describe("display", () => {
  it("formats the samples' committed values", () => {
    expect(formatValue("date", "2026-11-06T14:00:00.000Z", "UTC")).toBe("Friday, November 6");
    expect(formatValue("time", "2026-11-06T14:00:00.000Z", "UTC")).toBe("2:00 PM");
    expect(formatValue("time", "2026-11-05T14:00:00Z", ny)).toBe("9:00 AM");
    expect(formatValue("datetime", "2026-11-05T14:00:00Z", ny)).toBe("Thursday, November 5 at 9:00 AM");
    expect(formatValue("name", "Dr. Priya Nair", ny)).toBe("Dr. Priya Nair");
    // Never JSON, and never a redaction placeholder as if it were a value.
    expect(formatValue("string", { a: 1 }, ny)).toBe("a value that can't be shown");
    expect(formatValue("string", ["x"], ny)).toBe("a value that can't be shown");
    expect(formatValue("name", "[person name 1]", ny)).toBe("a value that can't be shown");
    expect(formatValue("date", "[date 1]", ny)).toBe("a value that can't be shown");
  });

  it("returns the spoken words of each value", () => {
    const sentence = "You’re booked for Friday, November 6, 2026, at 2:00 p.m. with Dr. Priya Nair.";
    const utc = { ...ctx, tz: "UTC", callStartMs: 1793911370896 };
    expect(spokenValues("date", sentence, utc)).toEqual(["Friday, November 6, 2026"]);
    expect(spokenValues("time", sentence, utc)).toEqual(["2:00 p.m."]);
    expect(spokenValues("name", sentence, utc)).toEqual(["Dr. Priya Nair"]);
    expect(spokenValues("name", "with Dr. Okafor's colleague, Dr. Nair", utc)).toEqual(["Dr. Okafor", "Dr. Nair"]);
  });

  it("builds the samples' field rows", () => {
    const utc = { ...ctx, tz: "UTC", callStartMs: 1793911370896, otherNames: ["Dr. Amara Osei", "Dr. Miguel Torres"] };
    const sentence = "You’re booked for Friday, November 6, 2026, at 2:00 p.m. with Dr. Priya Nair.";
    expect(fieldCheck("date", "date", sentence, "2026-11-06T14:00:00.000Z", utc)).toEqual({
      field: "date",
      type: "date",
      from: "spoken",
      values: ["Friday, November 6, 2026"],
      committed: "Friday, November 6",
      status: "match",
    });
    expect(fieldCheck("time", "time", sentence, "2026-11-06T14:00:00.000Z", utc)).toMatchObject({ values: ["2:00 p.m."], committed: "2:00 PM", status: "match" });
    expect(fieldCheck("provider", "name", sentence, "Dr. Priya Nair", utc)).toMatchObject({ values: ["Dr. Priya Nair"], committed: "Dr. Priya Nair", status: "match" });

    const failed = "Your appointment with Dr. Nair is confirmed for September 24th at 9:00 AM.";
    const failedCtx = { ...utc, callStartMs: 1790205241776 };
    expect(fieldCheck("date", "date", failed, "2026-09-24T09:00:00.000Z", failedCtx)).toMatchObject({
      values: ["September 24th"],
      committed: "Thursday, September 24",
      status: "match",
    });
    expect(fieldCheck("time", "time", failed, "2026-09-24T09:00:00.000Z", failedCtx)).toMatchObject({ values: ["9:00 AM"], committed: "9:00 AM", status: "match" });
    expect(fieldCheck("provider", "name", failed, "Dr. Priya Nair", failedCtx)).toMatchObject({ values: ["Dr. Nair"], status: "match" });
  });

  it("a row is unresolved, with no committed value, when the committed value can't be read", () => {
    expect(fieldCheck("date", "date", "booked for the 6th", undefined, ctx)).toMatchObject({ committed: null, status: "unresolved" });
    expect(fieldCheck("time", "time", "at 3 PM", "soon", ctx)).toMatchObject({ committed: null, status: "unresolved" });
    expect(fieldCheck("note", "string", "fine", { a: 1 }, ctx)).toMatchObject({ committed: null, status: "unresolved" });
  });
});
