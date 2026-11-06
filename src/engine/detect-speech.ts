// The speech detector: reads one agent turn at a time and says which sentences carry a spoken claim.
// Pure, no model. A quote is the whole sentence, trimmed, with one closing . ! or ? removed, so it is
// always an exact substring of the turn. Order of checks within a sentence: deferral, refusal, offer,
// transfer, intention, completion.
import type { ChangeKind, Detection, Evidence, SpeechClass } from "@/report/schema";

export interface SentenceClass {
  cls: SpeechClass;
  kind?: ChangeKind;
  quote: string;
}

// ---------- Sentences ----------

const TITLES = /(?:^|[\s("'])(?:Dr|Mr|Mrs|Ms|St)\.$/;
const DAYPART = /(?:^|[\s\d])(?:a\.m|p\.m|A\.M|P\.M)\.$/;

/** Splits a turn into sentences. Never splits after a title or a.m./p.m. followed by a lowercase word. */
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
    if (ch === "." && TITLES.test(head)) continue;
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

const CHANGE_VERB = "(?:book|schedule|cancel|reschedule|update|move|change|set you up|put you down)";
const DEFERRAL =
  /\b(?:get back to you|call you back|follow up with you|have (?:someone|a (?:nurse|member|staff|colleague)) (?:call|follow|reach)|someone (?:will|from)[^.]*\b(?:call|reach|follow)|(?:i'?ll|i will|let me) (?:need to )?(?:check|find out|look into)[^.]*\band (?:get back|let you know|follow up))/i;
const REFUSAL =
  /\b(?:i(?:'m| am) (?:not able|unable)|i (?:can(?:'|no)t|cannot|can not)|i(?:'m| am) not (?:allowed|permitted)|i(?:'m| am) sorry,? (?:but )?i (?:can(?:'|no)t|cannot)|i don'?t have (?:the ability|access) to)\b/i;
const OFFER_IF = /\b(?:if you(?:'d| would) like|if you want|if you(?:'d| would) prefer|if that works)\b/i;
const OFFER_Q = /\b(?:would you like|do you want|shall i|should i|want me to|can i (?:go ahead|book|schedule|cancel|transfer|connect))\b/i;
const OFFER_CAN = new RegExp(
  `\\bi can (?:transfer|connect|put you through|help(?= (?:you )?(?:once|when|after|if|later|with that))|${CHANGE_VERB}(?! you with (?:any|all) of))\\b`,
  "i",
);
const TRANSFER =
  /(?:\b(?:i(?:'ll| will)|i(?:'m| am) going to|let me|i(?:'m| am)) (?:go ahead and )?(?:now )?(?:transfer|connect|put you through|pass you|hand you)\b|\btransferring you\b|\bconnecting you (?:to|with)\b|\bi(?:'m| am) (?:transferring|connecting)\b)/i;
const INTENTION = new RegExp(
  `\\b(?:i(?:'ll| will)|i(?:'m| am) going to|i(?:'m| am) gonna|let me|let's|i(?:'m| am) about to) (?:go ahead and |just |now )*${CHANGE_VERB}\\b`,
  "i",
);
const COMPLETION = new RegExp(
  [
    "\\byou(?:'re| are) (?:all set|booked|rescheduled|confirmed|scheduled|set)\\b",
    "\\b(?:is|are|has been|have been) (?:now )?(?:confirmed|booked|scheduled|cancel+ed|rescheduled|updated|moved|off the books)\\b",
    "\\bi(?:'ve| have) (?:now |just )?(?:booked|cancel+ed|rescheduled|scheduled|updated|moved|got you down)\\b",
    "^\\s*(?:(?:ok(?:ay)?|great|perfect|done|verified|all set)[,.!]?\\s+)*(?:both |all )?(?:booked|cancel+ed|rescheduled|moved|done|updated|scheduled)\\b",
    "(?:^|[,.]\\s*)(?:and )?(?:you(?:'re| are) )?(?:booked|rescheduled)\\b",
    "\\b(?:moved|booked|cancel+ed|rescheduled) you\\b",
    "\\bi(?:'ve| have) got you down\\b",
  ].join("|"),
  "i",
);

function kindOf(s: string): ChangeKind | undefined {
  if (/\breschedul|\bmoved?\b|\bmoving\b/i.test(s)) return "reschedule";
  if (/\bcancel/i.test(s)) return "cancel";
  if (/\bupdat|\bchanged?\b/i.test(s)) return "update";
  if (/\bbook|\bscheduled?\b|\bset you up\b|\bgot you down\b|\bappointment\b.*\bconfirmed\b|\bconfirmed\b/i.test(s)) return "book";
  return undefined;
}

function classOf(sentence: string): { cls: SpeechClass; kind?: ChangeKind } | null {
  const s = sentence.trim().replace(/[\u2018\u2019]/g, "'");
  if (s === "") return null;
  const question = /\?["”’']?$/.test(s);
  if (DEFERRAL.test(s)) return { cls: "deferral" };
  if (REFUSAL.test(s)) return { cls: "refusal" };
  if (OFFER_IF.test(s) && (OFFER_CAN.test(s) || INTENTION.test(s) || TRANSFER.test(s) || /\bi can\b/i.test(s))) {
    return { cls: "offer", kind: kindOf(s) && INTENTION.test(s) ? kindOf(s) : undefined };
  }
  if (question) {
    return OFFER_Q.test(s) ? { cls: "offer" } : null;
  }
  if (OFFER_CAN.test(s)) return { cls: "offer" };
  if (TRANSFER.test(s)) return { cls: "transfer" };
  if (INTENTION.test(s)) return { cls: "intention", kind: kindOf(s) };
  if (COMPLETION.test(s)) return { cls: "completion", kind: kindOf(s) };
  return null;
}

/** One entry per sentence that carries a class, in order. */
export function classifyTurn(text: string): SentenceClass[] {
  const out: SentenceClass[] = [];
  for (const sentence of splitSentences(text)) {
    const c = classOf(sentence);
    if (!c) continue;
    const quote = toQuote(sentence);
    if (quote === "") continue;
    out.push({ cls: c.cls, ...(c.kind ? { kind: c.kind } : {}), quote });
  }
  return out;
}

/** Spoken tool syntax: a tool name read aloud, or raw function-call markup. Returns the matching text. */
export function findToolSyntax(text: string, toolNames: string[]): string | null {
  for (const name of toolNames) {
    if (name === "") continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`\\b${escaped}\\s*\\(|\\b${escaped}\\b(?=[\\s]*[:{(])|\\bfunctions?\\.${escaped}\\b`).exec(text);
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
