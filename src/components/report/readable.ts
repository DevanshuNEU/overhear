// Spoken numbers as digits, for the transcript only. Speech to text writes "fourteenth of March nineteen eighty
// five" and "five five five one two three four", which are slow to scan. This reads those spans as "March 14,
// 1985" and "555 1234", and keeps the exact words beside each, so the screen can show either.
//
// Precision over recall: a wrong digit is worse than a word left as written. Anything unsure stays as it was:
// a single digit word ("one moment", "two people"), an ordinal from first to twelfth ("the second time"), a
// number next to another number word ("ten thirty"), a digit run that starts or ends on "oh", a day that is not
// on the calendar. spoken.ts reads dates for the checks, but only with a digit year and a known call start, and
// it is not to change for a display; this file is self-contained and pure.
export type Segment = { shown: string; exact: string };
/** A converted span: where its exact words sit in the text, and the digits that stand for them. */
export type Span = { start: number; end: number; shown: string; exact: string };
export type Range = { start: number; end: number };

const UNITS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const UNIT: Record<string, number> = Object.fromEntries(UNITS.map((w, i) => [w, i + 1]));
const TEEN: Record<string, number> = Object.fromEntries(TEENS.map((w, i) => [w, 10 + i]));
const TEN: Record<string, number> = Object.fromEntries(TENS.map((w, i) => [w, (i + 2) * 10]));
const ORDINAL_UNIT = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];
const ORDINAL: Record<string, number> = Object.fromEntries(ORDINAL_UNIT.map((w, i) => [w, i + 1]));
["tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth"].forEach(
  (w, i) => (ORDINAL[w] = 10 + i),
);
ORDINAL.twentieth = 20;
ORDINAL.thirtieth = 30;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

type Token = { word: string; raw: string; start: number; end: number };

/** Words, with their place. An apostrophe stays inside a word, so "one's" is not "one". */
function tokenize(text: string): Token[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}'’]+/gu), (m) => ({ word: m[0].toLowerCase(), raw: m[0], start: m.index, end: m.index + m[0].length }));
}

const isNumberWord = (w: string) => w in UNIT || w in TEEN || w in TEN || w === "hundred" || w === "thousand" || w === "zero";

type Hit = { count: number; shown: string };
/** What a reader at token i finds, as a count of tokens read and the digits for them. */
type Reader = { toks: Token[]; text: string };

/** True when token j follows token j-1 with only spaces or a hyphen between, so they were said as one run. */
function joined(r: Reader, j: number): boolean {
  return j > 0 && j < r.toks.length && /^[\s-]+$/.test(r.text.slice(r.toks[j - 1].end, r.toks[j].start));
}
/** As joined, but a comma may sit between ("March fourteenth, 1985"). */
function nearby(r: Reader, j: number): boolean {
  return j > 0 && j < r.toks.length && /^,?\s+$/.test(r.text.slice(r.toks[j - 1].end, r.toks[j].start));
}
const wordAt = (r: Reader, j: number) => (j >= 0 && j < r.toks.length ? r.toks[j].word : undefined);

/** A number from one to 99 at token i: "twenty two", "twelve", "five". */
function below100(r: Reader, i: number): { n: number; count: number } | null {
  const w = wordAt(r, i);
  if (w === undefined) return null;
  if (w in TEN) {
    const next = wordAt(r, i + 1);
    if (joined(r, i + 1) && next !== undefined && next in UNIT) return { n: TEN[w] + UNIT[next], count: 2 };
    return { n: TEN[w], count: 1 };
  }
  if (w in TEEN) return { n: TEEN[w], count: 1 };
  if (w in UNIT) return { n: UNIT[w], count: 1 };
  return null;
}

/** One to 999: "two hundred and five", "two hundred fifty", or a number below 100. */
function below1000(r: Reader, i: number): { n: number; count: number } | null {
  const head = below100(r, i);
  if (!head) return null;
  if (head.n < 100 && joined(r, i + head.count) && wordAt(r, i + head.count) === "hundred") {
    let count = head.count + 1;
    let n = head.n * 100;
    let j = i + count;
    if (joined(r, j) && wordAt(r, j) === "and" && joined(r, j + 1) && below100(r, j + 1)) j += 1;
    const rest = joined(r, j) ? below100(r, j) : null;
    if (rest) {
      n += rest.n;
      j += rest.count;
    }
    count = j - i;
    return { n, count };
  }
  return head;
}

/** A whole number from the words at i. Sizes up to the thousands. */
function cardinal(r: Reader, i: number): { n: number; count: number } | null {
  const head = below1000(r, i);
  if (!head) return null;
  const at = i + head.count;
  if (joined(r, at) && wordAt(r, at) === "thousand") {
    let n = head.n * 1000;
    let j = at + 1;
    if (joined(r, j) && wordAt(r, j) === "and" && joined(r, j + 1) && below1000(r, j + 1)) j += 1;
    const rest = joined(r, j) ? below1000(r, j) : null;
    if (rest) {
      n += rest.n;
      j += rest.count;
    }
    return { n, count: j - i };
  }
  return head;
}

/** An ordinal at token i: "fourteenth", "twenty first", "thirtieth". */
function ordinal(r: Reader, i: number): { n: number; count: number } | null {
  const w = wordAt(r, i);
  if (w === undefined) return null;
  if (w === "twenty" || w === "thirty") {
    const next = wordAt(r, i + 1);
    if (joined(r, i + 1) && next !== undefined && next in ORDINAL && ORDINAL[next] < 10) return { n: TEN[w] + ORDINAL[next], count: 2 };
  }
  if (w in ORDINAL) return { n: ORDINAL[w], count: 1 };
  return null;
}

const suffix = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");

/** A spoken year from 1900 to 2099 at token i: "nineteen eighty five", "twenty twenty four", "two thousand twelve", or digits. */
function year(r: Reader, i: number): Hit | null {
  const w = wordAt(r, i);
  if (w === undefined) return null;
  if (/^(19|20)\d\d$/.test(w)) return { count: 1, shown: w };
  if ((w === "nineteen" || w === "twenty") && joined(r, i + 1)) {
    const base = w === "nineteen" ? 1900 : 2000;
    const second = wordAt(r, i + 1)!;
    if (second === "oh" && joined(r, i + 2) && wordAt(r, i + 2)! in UNIT) return { count: 3, shown: String(base + UNIT[wordAt(r, i + 2)!]) };
    if (second in TEEN) return { count: 2, shown: String(base + TEEN[second]) };
    if (second in TEN) {
      const unit = wordAt(r, i + 2);
      if (joined(r, i + 2) && unit !== undefined && unit in UNIT) return { count: 3, shown: String(base + TEN[second] + UNIT[unit]) };
      return { count: 2, shown: String(base + TEN[second]) };
    }
  }
  if (w === "two" && joined(r, i + 1) && wordAt(r, i + 1) === "thousand") {
    let j = i + 2;
    if (joined(r, j) && wordAt(r, j) === "and") j += 1;
    const rest = joined(r, j) ? below100(r, j) : null;
    if (rest && rest.n < 100) return { count: j + rest.count - i, shown: String(2000 + rest.n) };
  }
  return null;
}

/** A year after a date, with an optional comma before it. */
function yearAfter(r: Reader, i: number): Hit | null {
  if (!nearby(r, i) && !joined(r, i)) return null;
  return year(r, i);
}

const monthOf = (word: string) => MONTHS.findIndex((m) => m.toLowerCase() === word);

/** "the fourteenth of March nineteen eighty five" or "March fourteenth, nineteen eighty five". */
function date(r: Reader, i: number): Hit | null {
  let at = i;
  const lead = wordAt(r, at) === "the" && joined(r, at + 1);
  if (lead) at += 1;
  const day = ordinal(r, at);
  let month = -1;
  let dayN = 0;
  let end = at;
  if (day && joined(r, at + day.count) && wordAt(r, at + day.count) === "of" && joined(r, at + day.count + 1)) {
    const m = monthOf(wordAt(r, at + day.count + 1) ?? "");
    if (m >= 0) {
      month = m;
      dayN = day.n;
      end = at + day.count + 2;
    }
  } else if (!lead || day === null) {
    // Month first. May is a verb too, so it needs its capital.
    const w = r.toks[i];
    const m = monthOf(w.word);
    const next = joined(r, i + 1) ? (wordAt(r, i + 1) === "the" && joined(r, i + 2) ? i + 2 : i + 1) : -1;
    if (m >= 0 && next >= 0 && (m !== 4 || w.raw[0] === "M")) {
      const d = ordinal(r, next);
      if (d) {
        month = m;
        dayN = d.n;
        end = next + d.count;
      }
    }
  }
  if (month < 0 || dayN < 1 || dayN > DAYS_IN[month]) return null;
  const y = yearAfter(r, end);
  const count = end + (y ? y.count : 0) - i;
  return { count, shown: `${MONTHS[month]} ${dayN}${y ? `, ${y.shown}` : ""}` };
}

/** Three or more digit words in a row: "five five five one two three four". Phone numbers and codes. */
function digitRun(r: Reader, i: number): { hit: Hit | null; count: number } {
  const digit = (w: string | undefined) => w !== undefined && (w in UNIT || w === "zero" || w === "oh");
  let j = i;
  while (digit(wordAt(r, j)) && (j === i || joined(r, j))) j += 1;
  const count = j - i;
  const words = r.toks.slice(i, j).map((t) => t.word);
  if (count < 3 || words[0] === "oh" || words[count - 1] === "oh") return { hit: null, count };
  const digits = words.map((w) => (w === "zero" || w === "oh" ? "0" : String(UNIT[w]))).join("");
  const grouped =
    digits.length === 7 ? `${digits.slice(0, 3)} ${digits.slice(3)}`
    : digits.length === 10 ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`
    : digits.length === 11 && digits[0] === "1" ? `1 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`
    : digits;
  return { hit: { count, shown: grouped }, count };
}

const withCommas = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * What can be read at token i, the one that says most first: a date, a year, an ordinal, a number, a digit run. `skip`
 * is how many tokens to pass when none is taken, so the rest of a run is not read from its middle.
 */
function candidatesAt(r: Reader, i: number): { hits: Hit[]; skip: number } {
  const hits: Hit[] = [];
  const d = date(r, i);
  if (d) hits.push(d);
  const y = year(r, i);
  // A bare digit year is already digits.
  if (y && !/^\d/.test(r.toks[i].word)) hits.push(y);
  const o = ordinal(r, i);
  if (o) {
    // From thirteenth up, so "the second time" and "first of all" are left alone. The day of a date that failed
    // above ("April thirty first", "the thirty first of April") is not a lone ordinal either.
    const after = joined(r, i + o.count) && wordAt(r, i + o.count) === "of" && monthOf(wordAt(r, i + o.count + 1) ?? "") >= 0;
    const before = i > 0 && monthOf(wordAt(r, i - 1) ?? "") >= 0 && joined(r, i);
    if (o.n >= 13 && !after && !before) hits.push({ count: o.count, shown: `${o.n}${suffix(o.n)}` });
    else if (hits.length === 0) return { hits, skip: o.count };
  }
  const c = cardinal(r, i);
  if (c && (c.count > 1 || c.n >= 10)) hits.push({ count: c.count, shown: withCommas(c.n) });
  const run = digitRun(r, i);
  if (run.hit) hits.push(run.hit);
  return { hits, skip: run.count >= 2 ? run.count : 1 };
}

/**
 * The spans of a turn's text that read as digits, in order. `exact` lists ranges that must keep their exact words, such
 * as a highlighted quote: a span that touches one is left as written. A span is also left as written when a
 * number word sits right before or after it, since "ten thirty" or "five five five twenty two" could be read more
 * than one way.
 */
export function readableSpans(text: string, exact: Range[] = []): Span[] {
  const r: Reader = { toks: tokenize(text), text };
  const spans: Span[] = [];
  let i = 0;
  while (i < r.toks.length) {
    const { hits, skip } = candidatesAt(r, i);
    const unambiguous = (h: Hit) =>
      !(i > 0 && joined(r, i) && isNumberWord(r.toks[i - 1].word)) &&
      !(i + h.count < r.toks.length && joined(r, i + h.count) && isNumberWord(r.toks[i + h.count].word));
    const hit = hits.find(unambiguous);
    if (!hit) {
      i += skip;
      continue;
    }
    const start = r.toks[i].start;
    const end = r.toks[i + hit.count - 1].end;
    if (!exact.some((x) => x.start < end && start < x.end)) spans.push({ start, end, shown: hit.shown, exact: text.slice(start, end) });
    i += hit.count;
  }
  return spans;
}

/** A turn as segments in order: converted spans, and the text between them as written. Empty text has no segments. */
export function readableSegments(text: string, exact: Range[] = []): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const s of readableSpans(text, exact)) {
    if (s.start > at) out.push({ shown: text.slice(at, s.start), exact: text.slice(at, s.start) });
    out.push({ shown: s.shown, exact: s.exact });
    at = s.end;
  }
  if (at < text.length) out.push({ shown: text.slice(at), exact: text.slice(at) });
  return out;
}
