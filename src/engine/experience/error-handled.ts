// error_handled: when something goes wrong, does the agent handle it well? Two problems it finds: system details
// read to the caller (a raw error, a code, a placeholder, a fragment of JSON, a tool call spoken aloud) and a failed
// tool the agent gave the caller no way forward from (no callback, no person, no time to try again).
// Precision over recall: a phrase counts only as whole words, and a way forward counts wherever it appears in a
// turn, so a negated "I can't place callbacks" hides a problem rather than inventing one.
import type { Evidence, ExperienceProblem } from "@/report/schema";
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
// A JSON fragment: an opening {" with what follows it, or a quoted key ending in ":" (the key is the quote).
const JSON_RE = /\{"[^{}\n]{0,60}\}?|(?:"[^"\n]{1,40})?":/g;

interface Span {
  start: number;
  end: number;
}

/** Every match of a global pattern in the text, with where it sits. */
function spans(re: RegExp, text: string): (Span & { quote: string })[] {
  return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length, quote: m[0] }));
}

/** The words of an agent turn that read system details, in order of appearance. A match inside a larger one is left out. */
function leakedWords(text: string, toolSyntax: string[]): string[] {
  const found = [
    ...spans(LEAK_PHRASE_RE, text),
    ...spans(LEAK_EXACT_RE, text),
    ...spans(PLACEHOLDER_RE, text),
    ...spans(JSON_RE, text),
    ...toolSyntax.map((quote) => ({ start: Math.max(0, text.indexOf(quote)), end: Math.max(0, text.indexOf(quote)) + quote.length, quote })),
  ];
  // A match inside a larger one is part of it: drop it. Equal spans keep the first.
  const kept = found.filter((a, i) => !found.some((b, j) => j !== i && b.start <= a.start && a.end <= b.end && (b.end - b.start > a.end - a.start || j < i)));
  return [...new Set(kept.sort((a, b) => a.start - b.start).map((k) => k.quote))];
}

export const errorHandled: ExperienceCheck = (ev: Evidence, ctx) => {
  const agentTurns = ev.items.flatMap((it) => (it.kind === "turn" && it.role === "agent" ? [it] : []));
  if (agentTurns.length === 0) return { ran: false, problems: [] };

  const problems: ExperienceProblem[] = [];
  for (const turn of agentTurns) {
    const syntax = ctx.detections.filter((d) => d.seq === turn.seq && d.cls === "tool_syntax").map((d) => d.quote);
    const words = leakedWords(turn.text, syntax);
    if (words.length > 0) problems.push({ check: "error_handled", text: leakedInternalsText(turn.seq, words.join(", "), ev), seqs: [turn.seq] });
  }

  // The first failure, from a tool result or a backend action. The agent's next turn is cited as the one that
  // should have offered a way forward; with no turn after the failure there is nothing to cite, so no problem.
  const failure = ev.items.find((it) => (it.kind === "tool_result" || it.kind === "backend_action") && it.ok === false);
  if (failure) {
    const after = agentTurns.filter((t) => t.seq > failure.seq);
    if (after.length > 0 && !after.some((t) => WAY_FORWARD_RE.test(t.text))) problems.push({ check: "error_handled", text: noWayForwardText(failure.seq, ev), seqs: [after[0].seq] });
  }
  return { ran: true, problems };
};
