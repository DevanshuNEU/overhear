// spoken_format: are dates and times read the way a person says them? Two problems it finds: the year read aloud
// for a date a day or a week away ("November 6, 2026" for a call on November 5, 2026) and a date or time read in
// computer format ("2026-11-06", "15:00").
// Precision over recall: dates come from spoken.ts, the engine's one reader of spoken dates, so a date it is unsure
// of is not flagged. A year said for a date in another calendar year is helpful, not robotic, and a date of birth
// is never about the call, and a past date is a record read back. Each rule gives one problem for the whole call, citing every turn that showed it.
import type { Evidence, ExperienceProblem } from "@/report/schema";
import { spokenYearDates } from "../spoken";
import { computerFormatText, yearAloudText, type SaidAt } from "../wording";
import type { ExperienceCheck } from "./common";

/** A date from the call's own day up to this many days after it is close enough that saying the year is stiff. A past date is a record read back, which is normal speech. */
export const NEAR_DAYS = 180;

/** Words just before a date that make it a birth date, which says nothing about the call. */
const BIRTH_WORDS = /\b(?:born|birth|birthday|birthdate|dob)\b|d\.o\.b/i;
/** How far before a date those words count. */
const BIRTH_LOOKBACK = 50;
/** How far after a date they count, or to the end of the sentence, whichever is shorter. */
const BIRTH_LOOKAHEAD = 40;
const SENTENCE_END = /[.?!](?:\s|$)/;

const MONTH_DAY = "(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])";
// An ISO timestamp first, so its time is part of it. The zone is optional: "Z", "+05:30", "-0500".
const ISO_TIMESTAMP = String.raw`(?<![\w-])(?:19|20)\d{2}-${MONTH_DAY}[T ](?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?(?!\d)`;
const ISO_DATE = String.raw`(?<![\w-])(?:19|20)\d{2}-${MONTH_DAY}(?!\d)`;
// 13:00 to 23:59, which no one says aloud. 12:30 and under could be said either way, so they are left alone, and so is
// anything followed by a.m. or p.m. (that is a person's time with a wrong hour, not a machine format).
// Ratios and scores shaped like HH:MM (13 to 23) are an accepted limit on clinic calls.
const TIME_24H = String.raw`(?<![\d:.])(?:1[3-9]|2[0-3]):[0-5]\d(?::[0-5]\d)?(?![\d:])(?!\s*[ap]\.?\s?m(?![a-z]))`;
const COMPUTER_FORMAT_RE = new RegExp(`${ISO_TIMESTAMP}|${ISO_DATE}|${TIME_24H}`, "gi");

interface Span {
  start: number;
  end: number;
}

/** The computer-format fragments of an agent turn, in order, each a verbatim slice of it. Overlapping matches are one fragment, and a fragment said twice is listed once. */
function computerFragments(text: string): string[] {
  const found: Span[] = [...text.matchAll(COMPUTER_FORMAT_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const merged: Span[] = [];
  for (const span of found) {
    const last = merged.at(-1);
    if (last && span.start < last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return [...new Set(merged.map((m) => text.slice(m.start, m.end)))];
}

/** Whether birth is named in the same breath as a date: just before it, or after it up to 40 characters or the end of the sentence. */
function aboutBirth(text: string, start: number, end: number): boolean {
  const after = text.slice(end, end + BIRTH_LOOKAHEAD);
  const stop = after.search(SENTENCE_END);
  return BIRTH_WORDS.test(text.slice(Math.max(0, start - BIRTH_LOOKBACK), start)) || BIRTH_WORDS.test(stop === -1 ? after : after.slice(0, stop));
}

/** The dates in an agent turn said with a year that fall from the call's day to 180 days after it, in the call's own year, each a verbatim slice of the turn. */
function yearAloudDates(text: string, callStartMs: number | null, tz: string): string[] {
  const near = spokenYearDates(text, callStartMs, tz).filter((d) => d.sameYearAsCall && d.daysFromCall >= 0 && d.daysFromCall <= NEAR_DAYS && !aboutBirth(text, d.start, d.end));
  return [...new Set(near.map((d) => text.slice(d.start, d.end).trim()))];
}

export const spokenFormat: ExperienceCheck = (ev: Evidence, ctx) => {
  const agentTurns = ev.items.flatMap((it) => (it.kind === "turn" && it.role === "agent" ? [it] : []));
  // The computer-format rule can always run, so the check runs on any call with an agent turn. The year rule needs
  // the call's start to measure from, and quietly finds nothing without it.
  if (agentTurns.length === 0) return { ran: false, problems: [] };

  // One problem per rule for the whole call: the same habit shown at several turns is still one line, citing each turn.
  const years: SaidAt[] = [];
  const computer: SaidAt[] = [];
  for (const turn of agentTurns) {
    const dates = yearAloudDates(turn.text, ev.callStartMs, ctx.tz);
    if (dates.length > 0) years.push({ seq: turn.seq, quotes: dates });
    const fragments = computerFragments(turn.text);
    if (fragments.length > 0) computer.push({ seq: turn.seq, quotes: fragments });
  }
  const problems: ExperienceProblem[] = [];
  if (years.length > 0) problems.push({ check: "spoken_format", text: yearAloudText(years, ev), seqs: years.map((t) => t.seq) });
  if (computer.length > 0) problems.push({ check: "spoken_format", text: computerFormatText(computer, ev), seqs: computer.map((t) => t.seq) });
  return { ran: true, problems };
};
