// error_handled: when something goes wrong, does the agent handle it well? Two problems it finds: system details
// read to the caller (a raw error, a code, a placeholder, a fragment of JSON, a tool call spoken aloud) and a failed
// tool the agent gave the caller no way forward from (no callback, no person, no time to try again).
// Precision over recall: a phrase counts only as whole words, and a way forward counts wherever it appears in a
// turn, so a negated "I can't place callbacks" hides a problem rather than inventing one.
import type { Evidence, ExperienceProblem, Item } from "@/report/schema";
import { leakedInternalsText, noWayForwardText } from "../wording";
import type { ExperienceCheck } from "./common";

/** Phrases that mean an agent turn read system details aloud, matched case-insensitively as whole words. */
export const LEAK_PHRASES = [
  "returned an error",
  "returned a temporary error",
  "system error",
  "server error",
  "internal error",
  "error code",
  "status code",
  "an exception occurred",
  "threw an exception",
  "exception was thrown",
  "null",
  "undefined",
] as const;

/** Words that read system details aloud only in this exact case: "API" is a leak, "api" and "rapid" are not. */
export const LEAK_EXACT_CASE_WORDS = ["API"] as const;

/** Phrases that make an agent turn a way forward after a failed tool, matched case-insensitively as whole words. */
export const WAY_FORWARD_PHRASES = [
  "call you back",
  "callback",
  "call back",
  "transfer you",
  "connect you",
  "put you through",
  "someone will",
  "a staff member",
  "a person",
  "nurse",
  "text you",
  "email you",
  "try again at",
  "try again in",
  "try again after",
] as const;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWords = (words: readonly string[], flags: string) => new RegExp(`(?<!\\w)(?:${[...words].sort((a, b) => b.length - a.length).map(escape).join("|")})(?!\\w)`, flags);

const LEAK_PHRASE_RE = wholeWords(LEAK_PHRASES, "gi");
const LEAK_EXACT_RE = wholeWords(LEAK_EXACT_CASE_WORDS, "g");
const WAY_FORWARD_RE = wholeWords(WAY_FORWARD_PHRASES, "i");
const PLACEHOLDER_RE = /\{\{[^{}\n]*\}\}/g;
// A JSON fragment: an opening {" with what follows it, or a quoted key followed by a colon. A bare ": with no key
// before it is just punctuation after quoted speech.
const JSON_RE = /\{"[^{}\n]{0,60}\}?|"[^"\n]{1,40}":/g;

/** An agent turn needs this many words to be cited: Retell breaks a sentence around a tool call into fragments such as "I'm booking ". */
const MIN_CITED_WORDS = 3;

interface Span {
  start: number;
  end: number;
}

/** Every match of a global pattern in the text, with where it sits. */
function spans(re: RegExp, text: string): Span[] {
  return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

/**
 * The fragments of an agent turn that read system details, in order, each a verbatim slice of the turn (a fragment said twice is listed once). Matches that
 * overlap or touch are one fragment, so a spoken tool call is quoted whole, braces and all.
 */
function leakedFragments(text: string, toolSyntax: string[]): string[] {
  const found: Span[] = [
    ...spans(LEAK_PHRASE_RE, text),
    ...spans(LEAK_EXACT_RE, text),
    ...spans(PLACEHOLDER_RE, text),
    ...spans(JSON_RE, text),
    ...toolSyntax.flatMap((quote) => (text.includes(quote) ? [{ start: text.indexOf(quote), end: text.indexOf(quote) + quote.length }] : [])),
  ].sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of found) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return [...new Set(merged.map((m) => text.slice(m.start, m.end)))];
}

/** The tool a result or backend action belongs to, by name; null when the record does not say. */
function toolOf(it: Item, names: Map<string, string>): string | null {
  if (it.kind === "backend_action") return it.tool;
  if (it.kind === "tool_result") return names.get(it.id) ?? null;
  return null;
}

/** The first failed tool result or backend action that no later success of the same tool fixed. */
function firstUnresolvedFailure(ev: Evidence): Item | undefined {
  const names = new Map(ev.items.flatMap((it) => (it.kind === "tool_call" ? [[it.id, it.name] as const] : [])));
  return ev.items.find((it) => {
    if ((it.kind !== "tool_result" && it.kind !== "backend_action") || it.ok !== false) return false;
    const tool = toolOf(it, names);
    return !ev.items.some((later) => later.seq > it.seq && (later.kind === "tool_result" || later.kind === "backend_action") && later.ok === true && tool !== null && toolOf(later, names) === tool);
  });
}

/** Whether the agent offers a way forward after this seq: its turns are read in runs, a caller turn ending a run. */
function hasWayForward(ev: Evidence, afterSeq: number): boolean {
  const runs: string[][] = [[]];
  for (const it of ev.items) {
    if (it.seq <= afterSeq || it.kind !== "turn") continue;
    if (it.role === "caller") runs.push([]);
    else runs[runs.length - 1].push(it.text);
  }
  return runs.some((run) => WAY_FORWARD_RE.test(run.join(" ")));
}

const wordCount = (text: string): number => text.split(/\s+/).filter((w) => w !== "").length;

export const errorHandled: ExperienceCheck = (ev: Evidence, ctx) => {
  const agentTurns = ev.items.flatMap((it) => (it.kind === "turn" && it.role === "agent" ? [it] : []));
  if (agentTurns.length === 0) return { ran: false, problems: [] };

  const problems: ExperienceProblem[] = [];
  for (const turn of agentTurns) {
    const syntax = ctx.detections.filter((d) => d.seq === turn.seq && d.cls === "tool_syntax").map((d) => d.quote);
    const fragments = leakedFragments(turn.text, syntax);
    if (fragments.length > 0) problems.push({ check: "error_handled", text: leakedInternalsText(turn.seq, fragments, ev), seqs: [turn.seq] });
  }

  // Without a reliable order "after the failure" is unknowable, so this rule does not run. Otherwise: the first
  // failure no later success of the same tool fixed. A way forward anywhere after it settles it, including one split
  // across adjacent agent fragments (Retell breaks a sentence around tool calls, so "call you" / "back" is one
  // phrase). Otherwise the first full agent turn after it is cited (a fragment such as "I'm booking " is not a turn
  // to point at); with none after the failure there is nothing to cite, so no problem.
  const failure = ev.ordering === "none" ? undefined : firstUnresolvedFailure(ev);
  if (failure) {
    const after = agentTurns.filter((t) => t.seq > failure.seq);
    const cited = after.find((t) => wordCount(t.text) >= MIN_CITED_WORDS);
    if (cited && !hasWayForward(ev, failure.seq)) problems.push({ check: "error_handled", text: noWayForwardText(failure.seq, ev), seqs: [cited.seq] });
  }
  return { ran: true, problems };
};
