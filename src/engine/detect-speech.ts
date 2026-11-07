// The speech detector: reads one agent turn at a time and says which sentences carry a spoken claim.
// Pure, no model. A quote is the whole sentence, trimmed, with one closing . ! or ? removed, so it is
// always an exact substring of the turn. A sentence can carry several classes. One of deferral, refusal
// or offer is chosen in that order, else transfer and intention are both read, and a completion is always
// tested on top of it, so "You're booked, would you like a reminder?" is a completion and an offer and
// "Booking you now, then I'll connect you" is an intention and a transfer. Classes come out in the order
// their words appear.
import type { ChangeKind, Detection, Evidence, SpeechClass } from "@/report/schema";

export interface SentenceClass {
  cls: SpeechClass;
  kind?: ChangeKind;
  quote: string;
}

// ---------- Sentences ----------

const TITLES = /(?:^|[\s("'])(?:Dr|Mr|Mrs|Ms|St|Prof|e\.g|i\.e)\.$/;
// "Elm St. You're booked": a St. followed by a word that opens a clause ends the sentence. Before a name
// ("St. Mary's") it does not.
const CLAUSE_OPENER = /^(?:you|your|you['’](?:re|ve|ll)|i|i['’](?:m|ll|ve|d)|we|we['’](?:re|ve|ll)|our|the|this|that|it|it['’]s|there|they|he|she|thanks|thank|please|great|perfect|done|booked|would|do|does|can|could|is|are|let|let['’]s|ok|okay|sure|no|yes)\b/i;
const DAYPART = /(?:^|[\s\d])(?:a\.m|p\.m|A\.M|P\.M)\.$/;

/** Splits a turn into sentences. Never splits after a title, e.g., i.e., inside A.M./P.M., or after a.m./p.m. before a lowercase word. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const push = (end: number) => {
    const piece = text.slice(start, end);
    if (piece.trim() !== "") out.push(piece);
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") {
      push(i);
      continue;
    }
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    // Take a run of closing marks and quotes together.
    let j = i;
    while (j + 1 < text.length && /[.!?"'”’)]/.test(text[j + 1]) && !/\s/.test(text[j + 1])) {
      if (text[j + 1] === "." && /[A-Z]/.test(text[j + 2] ?? "")) break;
      j++;
    }
    const next = text.slice(j + 1);
    const head = text.slice(start, i + 1);
    const spaced = /^\s/.test(next);
    const afterWord = next.replace(/^\s+/, "");
    if (ch === "." && TITLES.test(head) && !(/(?:^|[\s("'])St\.$/.test(head) && CLAUSE_OPENER.test(afterWord))) continue;
    if (ch === "." && /(?:^|[\s\d])[ap]$/i.test(text.slice(start, i)) && /^m\./i.test(text.slice(i + 1))) continue; // the dot inside A.M.
    if (ch === "." && DAYPART.test(head) && /^[a-z]/.test(afterWord)) continue;
    if (ch === "." && /\d$/.test(text.slice(0, i)) && /^\d/.test(next)) continue; // 3.5
    const boundary = next === "" || (spaced ? afterWord !== "" : /^[A-Z"“‘']/.test(next));
    if (boundary || next.trim() === "") {
      push(j + 1);
      i = j;
    }
  }
  push(text.length);
  return out;
}

function toQuote(sentence: string): string {
  return sentence.trim().replace(/[.!?]$/, "").trimEnd();
}

// ---------- Patterns ----------

// Words between a first-person lead and a chained "and book" that mean the agent is not doing it now: negated,
// conditional, or the caller does it ("so you can cancel and book", "a number to call and book", "let me know").
const CHAIN_BLOCK =
  "(?:never|not|if|whether|unless|once|when|you can|you to|to call|so you|so that|you could|you may|you should|you(?:'d|'ll| will)|let me know)\\b|n't";
const CHAIN_BLOCK_RE = new RegExp(`\\b(?:${CHAIN_BLOCK})`, "i");
const CHANGE_VERB = "(?:book|schedule|cancel|reschedule|update|move|change|set you up|put you down)";
const DEFERRAL =
  /\b(?:i can help (?:you )?(?:once|when|after|later|as soon as)|get back to you|call you back|follow up with you|have (?:someone|a (?:nurse|member|staff|colleague)) (?:call|follow|reach)|someone (?:will|from)[^.]*\b(?:call|reach|follow)|(?:i'?ll|i will|let me) (?:need to )?(?:check|find out|look into)[^.]*\band (?:get back|let you know|follow up))/i;
const REFUSAL = new RegExp(
  "\\b(?:" +
    [
      "i(?:'m| am) (?:not able|unable)",
      "i (?:can(?:'|no)t|cannot|can not)",
      "i(?:'m| am) not (?:allowed|permitted)",
      "i(?:'m| am) sorry,? (?:but )?i (?:can(?:'|no)t|cannot)",
      "i don'?t have (?:the ability|access) to",
      // Past tense: "I wasn't able to book that", "I couldn't transfer you".
      "i (?:wasn'?t|was not) (?:able|allowed|permitted)",
      "i was unable",
      `i (?:couldn'?t|could not) (?=(?:go ahead and |even )?(?:${CHANGE_VERB}|transfer|connect|put you through)\\b)`,
    ].join("|") +
    ")\\b",
  "i",
);
const OFFER_IF = /\b(?:if you(?:'d| would) like|if you want|if you(?:'d| would) prefer|if that works)\b/i;
const OFFER_Q = /\b(?:would you like|do you want|shall i|should i|want me to|can i (?:go ahead|book|schedule|cancel|transfer|connect))\b/i;
const OFFER_CAN = new RegExp(
  `\\bi can (?:transfer|connect|put you through|help(?= (?:you )?if\\b)|${CHANGE_VERB}(?! you with (?:any|all) of))\\b`,
  "i",
);
const TRANSFER =
  /(?:\b(?:i(?:'ll| will)|i(?:'m| am) going to|let me|i(?:'m| am)) (?:go ahead and )?(?:now )?(?:transfer|connect|put you through|pass you|hand you)\b|\btransferring you\b|\bconnecting you (?:to|with)\b|\bi(?:'m| am) (?:transferring|connecting)\b)/i;
// "Let me book that and then put you through": a transfer chained onto a first-person clause. The lead is
// required, so "The front desk will review it and transfer you" and "They book and transfer you" are not.
const TRANSFER_CHAIN = /\b(?:and|then)\s+(?:(?:i(?:'ll| will)|let me)\s+)?(?:transfer you|connect you|put you through)\b/i;
const LEAD = /\b(?:i(?:'ll| will)|i(?:'m| am) going to|i(?:'m| am) gonna|let me)\s/i;
const INTENTION = new RegExp(
  [
    `\\b(?:i(?:'ll| will)|i(?:'m| am) going to|i(?:'m| am) gonna|let me|let's|i(?:'m| am) about to) (?:go ahead and |just |now )*${CHANGE_VERB}\\b`,
    // "Let me get you booked", "Let's get your checkup booked"
    "\\b(?:i(?:'ll| will)|let me|let's) get (?:you|your \\w+) (?:booked|scheduled|rescheduled|cancel+ed|set up)\\b",
    // Said as it happens: "booking that now", "Booking now", "Locking in Monday at 9"
    "(?<!\\b(?:before|after|for|about|by) )\\b(?:booking|rescheduling|cancell?ing|moving)\\b[^!?]*\\bnow\\b",
    "^\\s*locking in\\b",
    // "Let me check the calendar and put you down": a booking chained onto a first-person clause.
    `\\b(?:i(?:'ll| will)|let me|let's) (?:(?!\\b${CHAIN_BLOCK})[^.,;!?])*?\\b(?:and|then) (?:i(?:'ll| will) )?(?:go ahead and )?(?:book|schedule|cancel|reschedule|set you up|put you down)\\b`,
  ].join("|"),
  "i",
);
// Words that make a booking claim conditional or a question: "if you're booked", "once I've booked you".
const CONDITIONAL = /\b(?:if|once|before|when|whenever|after|until|unless|as soon as|in case|whether)\b/i;
const NEGATED = /(?:\bnot|\bnever|\bnothing|\bnobody|\bno one|n't)(?:\s+\w+){0,2}\s*$/i;
const INVERTED = /^\s*(?:is|are|was|were|has|have|had|did|do|does|can|could|will|would|should|shall)\b/i;

// The caller's own booking: "it", "that", "this", or "your ... appointment". "That slot", "Dr. Osei" and
// "we're" are not, so "That slot is booked" and "Dr. Osei is booked" are about the calendar.
const MINE =
  "(?:it|that|this|your (?:[a-z0-9'-]+ ){0,2}(?:appointment|booking|visit|reservation|slot|checkup|check-up|consultation|follow-up|procedure|session)(?: (?:with|for|on|at) [^,;]{1,50}?)?)";
const IS = "(?:'s been|'s|\\s+is|\\s+are|\\s+has been|\\s+have been)";
const NOT_FULL = "(?! (?:solid|up|out)\\b)"; // "booked solid" says the calendar is full

// Each pattern finds one spoken completion. A kind found in the matched words wins over the sentence.
// Plain "scheduled" is how the calendar already stands ("You're scheduled for Tuesday already"), so only
// "now scheduled" and "officially scheduled" count as a new completion.
const COMPLETION = [
  `\\byou(?:'re| are) (?:all set|booked${NOT_FULL}|rescheduled|confirmed|set)\\b`,
  "\\byou(?:'re| are) (?:now |officially )+scheduled\\b",
  "\\byou(?:'re| are) good to go\\b",
  "^\\s*consider (?:it|that|this) (?:done|booked|cancel+ed|rescheduled|handled|taken care of)\\b",
  // "Your booking is complete", "Your cancellation is done".
  "\\byour (?:[a-z-]+ ){0,2}(?:booking|reservation|cancell?ation|reschedul(?:e|ing)|change|update)(?: request)? (?:is|has been) (?:now |all )?(?:complete|completed|done)\\b",
  // Moves and cancellations are about the caller's change whoever the subject is.
  "\\b(?:is|are|has been|have been|'s been) (?:now )?(?:confirmed|cancel+ed|rescheduled|updated|moved|off the books)\\b",
  `\\b${MINE}${IS} (?:now |all |officially )*(?:confirmed|booked${NOT_FULL}|set|cancel+ed|rescheduled|updated|moved)\\b`,
  `\\b${MINE}${IS} (?:now |officially )+scheduled\\b`,
  "\\b(?:i|we)(?:'ve| have)? (?:now |just |already |also |gone ahead and |went ahead and )*(?:booked|cancel+ed|rescheduled|scheduled|updated|moved|changed|put you down|made (?:the|your|an?) (?:appointment|booking)|got you (?:down|in|booked|scheduled|set))\\b",
  "^\\s*(?:(?:ok(?:ay)?|great|perfect|done|verified|all set)[,.!]?\\s+)*(?:both |all )?(?:booked(?! (?:solid|up|out)\\b)|cancel+ed|rescheduled|moved|done|updated|scheduled)\\b",
  `(?:^|[,.]\\s*)(?:and )?(?:you(?:'re| are) )?(?:booked${NOT_FULL}|rescheduled)\\b`,
  // "Booked you for 4pm", "and moved you": the agent is the subject only when nobody else is named.
  "(?:^|[,;]\\s*|\\b(?:and|then)\\s+)(?:just |already |also |now )?(?:booked|moved|cancel+ed|rescheduled) (?:you|that|it|this)\\b",
  "(?:^|[,;]\\s*|\\band\\s+)(?:just |already )?got (?:you|that|it|this) (?:booked|scheduled|all set|set)\\b",
  "\\bi(?:'ve| have) got (?:that|it|this) (?:booked|scheduled|set)\\b",
  "^\\s*all set for\\b",
].map((src) => new RegExp(src, "gi"));

const TRANSFER_DONE = /\bi(?:'ve| have) (?:now |just )?(?:transferred|connected|passed|handed) you\b|\bwhile i(?:'m| am)? (?:transfer|transferring|connect|connecting) you\b/i;

function kindOf(s: string): ChangeKind | undefined {
  if (/\breschedul|\bmoved?\b|\bmoving\b/i.test(s)) return "reschedule";
  if (/\bcancel|\boff the books\b/i.test(s)) return "cancel";
  if (/\bupdat|\bchanged?\b/i.test(s)) return "update";
  if (
    /\bbook|\bscheduled?\b|\bset you up\b|\bgot you (?:down|in)\b|\bput you down\b|\blocking in\b|\bconfirmed\b|\ball set\b[,\s]+(?:for|on|at|with|\d)|\b(?:it|that|appointment|booking)(?:'s|\s+is) (?:all )?set\b|\bmade (?:the|your|an?) (?:appointment|booking)\b/i.test(s)
  ) {
    return "book";
  }
  return undefined;
}

interface Hit {
  cls: SpeechClass;
  kind?: ChangeKind;
  at: number;
  /** "You're good to go" takes its kind from the turn: book when the rest of the turn is about a booking. */
  fromTurn?: boolean;
}

/** The clause of the sentence around a position, between commas and semicolons. */
function clauseAt(s: string, at: number): string {
  const from = Math.max(s.lastIndexOf(",", at - 1), s.lastIndexOf(";", at - 1)) + 1;
  const stops = [s.indexOf(",", at), s.indexOf(";", at)].filter((i) => i >= 0);
  return s.slice(from, stops.length ? Math.min(...stops) : s.length);
}

/** The rest of the clause after a position. */
function clauseTail(s: string, from: number): string {
  return s.slice(from).split(/[,;]|\b(?:and|but|since|because|so|which|then)\b/i)[0];
}

const GOOD_TO_GO = /\bgood to go\b/i;
// A clause that says the change has not happened: "the insurance update is pending", "I'll update it later".
const NOT_YET = /\b(?:pending|yet|still|later|will|i'll|let me|going to|gonna|not|waiting|in progress|if|once|when)\b|n't/i;

/** The kind named by another clause of the sentence, unless that clause says the change is still to come. */
function otherClauseKind(s: string, at: number): ChangeKind | undefined {
  const own = clauseAt(s, at);
  for (const clause of s.split(/[,;]/)) {
    if (clause === own || NOT_YET.test(clause)) continue;
    const kind = kindOf(clause);
    if (kind) return kind;
  }
  return undefined;
}

/** Whether the words before a match make it conditional, negated or a question rather than a claim. */
function notAClaim(s: string, at: number): boolean {
  const clauseStart = Math.max(s.lastIndexOf(",", at - 1), s.lastIndexOf(";", at - 1)) + 1;
  const before = s.slice(clauseStart, at);
  return CONDITIONAL.test(before) || NEGATED.test(before) || INVERTED.test(before);
}

/** Every completion in the sentence, one hit per change kind found in the matched words. */
function completions(s: string): Hit[] {
  const found: { at: number; kind?: ChangeKind }[] = [];
  for (const re of COMPLETION) {
    for (const m of s.matchAll(re)) {
      // A match may begin with its own comma ("..., booked"), so the words before it end where the match text starts.
      const start = m.index + (m[0].length - m[0].replace(/^[,.;]\s*/, "").length);
      if (notAClaim(s, start)) continue;
      // "already" says the calendar stood that way before: "Your appointment is already booked".
      if (!/^(?:i|we)\b/i.test(m[0]) && /\balready\b/i.test(clauseTail(s, m.index + m[0].length))) continue;
      found.push({ at: m.index, kind: kindOf(m[0]) });
    }
  }
  if (found.length === 0) return [];
  const byKind = new Map<ChangeKind, number>();
  for (const f of found) if (f.kind) byKind.set(f.kind, Math.min(byKind.get(f.kind) ?? Infinity, f.at));
  if (byKind.size > 0) return [...byKind].map(([kind, at]) => ({ cls: "completion", kind, at }));
  // No kind in the matched words: read the clause the claim sits in, so "You're all set for Tuesday, the
  // insurance update is pending" is a booking and not an update.
  const at = Math.min(...found.map((f) => f.at));
  // "You're all set, 8am on the 19th" carries its details after the comma, which is the booking itself.
  const kind = kindOf(clauseAt(s, at)) ?? otherClauseKind(s, at) ?? (/\ball set\b[,\s]+(?:for|on|at|with|\d)/i.test(s.slice(at)) ? "book" : undefined);
  return [{ cls: "completion", ...(kind ? { kind } : {}), at, ...(!kind && GOOD_TO_GO.test(s) ? { fromTurn: true } : {}) }];
}

const at = (re: RegExp, s: string): number => {
  const m = re.exec(s);
  return m ? m.index : -1;
};
const firstAt = (s: string, ...res: RegExp[]): number => {
  const hits = res.map((re) => at(re, s)).filter((i) => i >= 0);
  return hits.length ? Math.min(...hits) : 0;
};

// "ok?", "right?" after a claim is a tag question that keeps the claim: "I'm transferring you now, ok?"
const TAG_QUESTION = /,\s*(?:ok|okay|alright|all right|right)\s*\?["”’']?$/i;
// After a transfer or intention: "once the system is back" waits, "if needed" is only a maybe.
// "if that's okay" asks for a nod, it is not a condition on the claim.
const MAYBE = /\b(?:if|unless|in case)\b(?!\s+that(?:'s| is)\s+(?:ok|okay|fine|alright|all right|good)\b)/i;
// "I'll book you for Tuesday when Dr. Osei is in": a "when" after a day or time names the slot, not a wait.
const AVAILABLE = /^when(?:ever)?\s+(?:dr\.?\s+\w+|you|he|she|they|the (?:doctor|provider|nurse))(?:['’]re|['’]s| is| are)\s+(?:in|back|available|free|here|around)\b(?!\s+up\b)/i;
const TIMEISH = /\b(?:today|tomorrow|tonight|week|weekend|month|morning|afternoon|evening|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d\d)?\s*(?:am|pm|a\.m\.|p\.m\.)|\d{1,2}(?:st|nd|rd|th))\b/i;

/** What a transfer or intention match is worth, from the rest of its clause. */
function claimTail(s: string, end: number): "claim" | "deferral" | "maybe" {
  const tail = s.slice(end).split(/[,;.]|\b(?:then|and)\b/i)[0];
  const w = /\b(?:once|as soon as|when|whenever)\b/i.exec(tail);
  // "for Tuesday when Dr. Osei is in" names the slot's own availability; "tomorrow when the office opens"
  // waits on an event. When the two cannot be told apart, it is a wait.
  if (w && !(/^when(?:ever)?$/i.test(w[0]) && TIMEISH.test(tail.slice(0, w.index)) && AVAILABLE.test(s.slice(end + w.index)))) {
    return "deferral";
  }
  if (MAYBE.test(tail)) return "maybe";
  return "claim";
}

// A sentence that opens with a wait clause: "Once the system is back, I'll connect you", "When a nurse is free I'll
// transfer you". "Now that", "since", "because" and "so" state a fact or a reason, "before we hang up" promises the
// claim during this call, and "until" means act now in the meantime, so none of them are in the list. Idioms that open
// with a wait word but wait for nothing ("once again", "after all", "when it comes to", "as soon as possible") are out too.
const WAIT_FILLER = "(?:and|so|okay|ok|alright|all right|right|sure|great|perfect|thanks|thank you|um|uh|well|actually)";
const LEADING_WAIT = new RegExp(
  `^\\s*(?:${WAIT_FILLER}[,.!]?\\s+)*(?:once(?! (?:again|more)\\b)|after(?! all\\b)|whenever|when(?! it comes to\\b)|as soon as(?! possible\\b))\\b`,
  "i",
);

// A wait clause about something already done: "When I checked", "When you called earlier", "After checking".
const PAST_WAIT = /\b(?:checked|called|asked|spoke|looked|was|were|did|had)\b/i;

/**
 * What a transfer or intention starting at a position is worth. A leading wait clause stays a wait however many
 * commas it has ("Once Dr. Osei, our nurse, is back, I'll transfer you"), because a false deferral costs less than a
 * missed claim. It is finished in two cases: the claim is introduced by ", so" ("..., so I'll book you"), or the
 * wait verb is past or about something done ("When I checked", "After checking").
 */
function claimAt(s: string, at: number, end: number): "claim" | "deferral" | "maybe" {
  const prefix = s.slice(0, at);
  const m = LEADING_WAIT.exec(prefix);
  if (m) {
    const clause = prefix.slice(m[0].length);
    const head = clause.split(",")[0];
    const finished = /,\s*so\s*$/i.test(prefix) || PAST_WAIT.test(head) || (/after$/i.test(m[0]) && /^\s*\w+ing\b/i.test(clause));
    if (!finished) return "deferral";
  }
  return claimTail(s, end);
}

function lastIndexOf(re: RegExp, s: string): number {
  let at = -1;
  for (const m of s.matchAll(new RegExp(re.source, "gi"))) at = m.index;
  return at;
}

/** A chained transfer ("... and then put you through") that follows a first-person, un-negated, unconditional clause. */
function chainedTransfer(s: string): { at: number; end: number; lead: number } | null {
  const m = matchOf(TRANSFER_CHAIN, s);
  if (!m) return null;
  const before = s.slice(0, m.at);
  const lead = lastIndexOf(LEAD, before);
  const intention = matchOf(INTENTION, before);
  const from = lead >= 0 ? lead : intention ? intention.at : -1;
  if (from < 0) return null;
  if (lead >= 0 && CHAIN_BLOCK_RE.test(before.slice(from))) return null;
  if (NEGATED.test(before.trimEnd()) || notAClaim(s, m.at)) return null;
  return { ...m, lead: from };
}

function matchOf(re: RegExp, s: string): { at: number; end: number } | null {
  const m = re.exec(s);
  return m ? { at: m.index, end: m.index + m[0].length } : null;
}

/** The classes other than completion that a sentence carries: one of deferral, refusal or offer, else transfer and intention. */
function primary(s: string): Hit[] {
  const tagged = TAG_QUESTION.test(s);
  const body = s.replace(TAG_QUESTION, "");
  const question = /\?["”’']?$/.test(s) && !(tagged && !OFFER_Q.test(body) && !INVERTED.test(body));
  if (DEFERRAL.test(s)) return [{ cls: "deferral", at: firstAt(s, DEFERRAL) }];
  if (REFUSAL.test(s)) return [{ cls: "refusal", at: firstAt(s, REFUSAL) }];
  if (OFFER_IF.test(s) && (OFFER_CAN.test(s) || INTENTION.test(s) || TRANSFER.test(s) || /\bi can\b/i.test(s))) {
    const kind = kindOf(s) && INTENTION.test(s) ? kindOf(s) : undefined;
    return [{ cls: "offer", ...(kind ? { kind } : {}), at: firstAt(s, OFFER_IF, OFFER_CAN, INTENTION, TRANSFER, /\bi can\b/i) }];
  }
  if (question) return OFFER_Q.test(s) ? [{ cls: "offer", at: firstAt(s, OFFER_Q) }] : [];
  if (OFFER_CAN.test(s)) return [{ cls: "offer", at: firstAt(s, OFFER_CAN) }];
  const out: Hit[] = [];
  let waits = -1;
  const transfer: { at: number; end: number; lead?: number } | null = matchOf(TRANSFER, s) ?? chainedTransfer(s);
  if (transfer) {
    const tail = claimAt(s, transfer.lead ?? transfer.at, transfer.end);
    if (tail === "claim") out.push({ cls: "transfer", at: transfer.at });
    else if (tail === "deferral") waits = transfer.at;
  } else if (TRANSFER_DONE.test(s)) {
    out.push({ cls: "transfer", at: firstAt(s, TRANSFER_DONE) });
  }
  const intention = matchOf(INTENTION, s);
  if (intention) {
    const tail = claimAt(s, intention.at, intention.end);
    if (tail === "claim") {
      const kind = kindOf(clauseAt(s, intention.at));
      out.push({ cls: "intention", ...(kind ? { kind } : {}), at: intention.at });
    } else if (tail === "deferral") waits = waits < 0 ? intention.at : Math.min(waits, intention.at);
  }
  if (waits >= 0) out.push({ cls: "deferral", at: waits });
  return out;
}

function classesOf(sentence: string): Hit[] {
  const s = sentence.trim().replace(/[‘’]/g, "'");
  if (s === "") return [];
  const hits = [...completions(s), ...primary(s)];
  return hits.sort((x, y) => x.at - y.at);
}

/** One entry per sentence that carries a class, in order. */
export function classifyTurn(text: string): SentenceClass[] {
  const found: { hit: Hit; quote: string }[] = [];
  for (const sentence of splitSentences(text)) {
    const quote = toQuote(sentence);
    if (quote === "") continue;
    for (const hit of classesOf(sentence)) found.push({ hit, quote });
  }
  // "You're good to go" is a booking only when the rest of the turn is about one.
  const turnIsBooking = found.some((f) => !f.hit.fromTurn && f.hit.kind === "book");
  return found.map(({ hit, quote }) => {
    const kind = hit.fromTurn && turnIsBooking ? "book" : hit.kind;
    return { cls: hit.cls, ...(kind ? { kind } : {}), quote };
  });
}

/** Spoken tool syntax: a tool name read aloud, or raw function-call markup. Returns the matching text. */
export function findToolSyntax(text: string, toolNames: string[]): string | null {
  for (const name of toolNames) {
    if (name === "") continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A name with _ or . ("transfer_call") is never a spoken word, so any "(" or ":" after it is tool syntax. A plain
    // word ("book") needs argument-like content: braces, a quoted string, or key: value / key=value with one
    // token value. "book (if you want) tomorrow" and "book (tomorrow: 9am or Friday)" are just speech.
    const identifier = /[_.]/.test(name);
    const arg = "[\\w-]+\\s*[:=]\\s*[^\\s,)]+\\s*[,)]";
    const quoted = "([\"'`])[^)]*?\\1";
    const args = `\\(\\s*(?:\\{|\\[|${quoted}|${arg})`;
    const colonArgs = "\\s*:\\s*(?:[\\w-]+\\s*=|[\"'`{\\[]|\\d)";
    const call = identifier ? `\\b${escaped}\\s*\\(|\\b${escaped}${colonArgs}` : `\\b${escaped}\\s*${args}|\\b${escaped}\\(\\s*\\)`;
    const m = new RegExp(`${call}|\\b${escaped}\\s*\\{|\\bfunctions?\\.${escaped}\\b`).exec(text);
    if (m) return m[0];
  }
  const markup = /<\/?(?:function_calls?|tool_call|invoke)\b[^>]*>|\bfunctions\.\w+\s*\(|\{\s*"(?:name|tool|function)"\s*:/.exec(text);
  return markup ? markup[0] : null;
}

/** Every detection in a call, from agent turns only. Each quote is an exact substring of its turn. */
export function detectAll(ev: Evidence, toolNames: string[] = []): Detection[] {
  const out: Detection[] = [];
  for (const item of ev.items) {
    if (item.kind !== "turn" || item.role !== "agent") continue;
    for (const c of classifyTurn(item.text)) {
      out.push({ seq: item.seq, cls: c.cls, ...(c.kind ? { kind: c.kind } : {}), quote: c.quote, source: "code" });
    }
    const syntax = findToolSyntax(item.text, toolNames);
    if (syntax) out.push({ seq: item.seq, cls: "tool_syntax", quote: syntax, source: "code" });
  }
  return out;
}
