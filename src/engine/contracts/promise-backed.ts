// Contract 1, promise_backed (spec 6.4 item 1): each completion claim is tied to the most recent change before it whose
// kind matches, and that change must have succeeded with its result in before the claim.
//
// One finding per agent turn that carries a claim, not one per detection: a turn with several claims gets the worst of
// them. A claim with no clear kind ("you're all set") matches any earlier change and counts only when one was
// attempted before it. A reschedule claim also matches a cancel followed by a book, which stands or falls as one
// change. Transfer claims and deferrals are other contracts' business. A change tool the policy gives no kind backs a
// claim of any kind, since the record can't say what it was for. A claim no described change backs is violated only
// when every earlier tool call is one the policy describes; a tool it doesn't describe might have been the change.
// Nothing is violated on shaky evidence: a gap that touches the claim, the call or its result, or ordering none,
// makes the finding unverified.
import type { ChangeKind, Detection, Evidence, Finding, GapCode } from "@/report/schema";
import type { ToolUse } from "../committed";
import { toolPolicy } from "../policy";
import {
  REASONS,
  describeGap,
  errorReason,
  formatTime,
  promisePassedText,
  promiseViolatedText,
  unknownToolCause,
  unverifiedText,
  type GapText,
  type PromiseReason,
} from "../wording";
import { gapsTouching, softenForMissingTools, worst, type Contract, type ContractContext } from "./common";

/** The change or changes that stand behind one claim: a single change, or a cancel then a book. */
type Backing = ToolUse[];

const SEVERITY: Record<Finding["result"], number> = { violated: 2, unverified: 1, passed: 0 };

export const promiseBacked: Contract = (ctx) => {
  const byTurn = new Map<number, Detection[]>();
  for (const d of ctx.detections) {
    if (d.cls === "completion") byTurn.set(d.seq, [...(byTurn.get(d.seq) ?? []), d]);
  }
  const findings = [...byTurn]
    .sort(([a], [b]) => a - b)
    .flatMap(([seq, claims]) => {
      // "You're all set" beside "your appointment is confirmed" is the same promise, so the clearer claim speaks.
      const kinded = claims.filter((c) => c.kind !== undefined);
      const judged = (kinded.length > 0 ? kinded : claims.slice(0, 1)).flatMap((c) => judge(ctx, seq, c) ?? []);
      if (judged.length === 0) return [];
      return [judged.reduce((w, f) => (SEVERITY[f.result] > SEVERITY[w.result] ? f : w))];
    });
  return { contract: "promise_backed", result: worst(findings.map((f) => f.result)), findings };
};

/** Judges one claim made at one agent turn; null when it is not a claim at all (a kindless one with nothing attempted). */
function judge(ctx: ContractContext, seq: number, claim: Detection): Finding | null {
  const { ev } = ctx;
  // With ordering none the seqs say nothing about what came first, so no change is "before" or "after" anything.
  const unordered = ev.ordering === "none" && hasToolCalls(ev);
  const earlier = unordered ? ctx.changes : ctx.changes.filter((c) => c.callSeq < seq);
  const backing = claim.kind ? backingFor(claim.kind, earlier) : latest(earlier);
  if (!claim.kind && !backing) return null;

  const did = seqsOf(backing);
  const kind: ChangeKind | undefined = claim.kind ?? backing?.at(-1)?.kind;
  const time = formatTime(seq, ev);
  const base = { said: [seq], did, asked: [], fields: [] };
  const violated = (reason: PromiseReason): Finding => ({
    ...base,
    result: "violated",
    text: promiseViolatedText(time, claim.quote, reason),
    gaps: [],
  });

  const touching = gapsTouching(ev, "promise_backed", [seq, ...did]);
  const causes: GapText[] = touching.map((g) => describeGap(g, { tool: backing?.at(-1)?.tool }));
  if (unordered) causes.push(REASONS.order_unknown);
  if (causes.length > 0) {
    const gaps: GapCode[] = [...new Set(touching.map((g) => g.code))];
    return { ...base, result: "unverified", text: unverifiedText("promise_backed", causes), gaps };
  }

  if (!backing) {
    // A tool the policy doesn't describe might have been the change, so nothing here proves one wasn't attempted.
    const unknown = undescribedBefore(ctx, seq);
    if (unknown.tools.length > 0) {
      return { ...base, did: unknown.seqs, result: "unverified", text: unverifiedText("promise_backed", [unknownToolCause(unknown.tools, kind)]), gaps: [] };
    }
    const later = claim.kind ? backingFor(claim.kind, ctx.changes.filter((c) => c.callSeq > seq)) : undefined;
    return softenForMissingTools(ev, violated({ why: later ? "attempted_later" : "not_attempted", kind }), "promise_backed");
  }

  if (backing.some((c) => c.resultSeq === null || c.resultSeq > seq)) return violated({ why: "unfinished", kind });
  const failed = backing.find((c) => c.ok === false);
  if (failed) {
    // A tool the policy doesn't describe, run after the failure, may have been a retry that worked.
    const retry = undescribedBefore(ctx, seq, failed.callSeq);
    if (retry.tools.length > 0) {
      const seqs = [...did, ...retry.seqs].sort((a, b) => a - b);
      return { ...base, did: seqs, result: "unverified", text: unverifiedText("promise_backed", [unknownToolCause(retry.tools, kind)]), gaps: [] };
    }
    return violated({ why: "failed", kind, error: errorReason(failed.result) });
  }
  const unknown = backing.find((c) => c.ok === null);
  if (unknown) {
    const cause = describeGap({ code: "unknown_success", tool: unknown.tool });
    return { ...base, result: "unverified", text: unverifiedText("promise_backed", [cause]), gaps: [] };
  }
  return { ...base, result: "passed", text: promisePassedText(time, claim.quote, kind), gaps: [] };
}

/**
 * The tools used before a claim that the policy gives no role, in order of first use, with the seqs of their calls.
 * With `after`, only those used after that seq.
 */
function undescribedBefore(ctx: ContractContext, seq: number, after = -Infinity): { tools: string[]; seqs: number[] } {
  const used = ctx.ev.items.flatMap((it) => {
    if (it.seq >= seq || it.seq <= after) return [];
    if (it.kind === "tool_call") return [{ seq: it.seq, name: it.name }];
    if (it.kind === "backend_action") return [{ seq: it.seq, name: it.tool }];
    return [];
  });
  const unknown = used.filter((u) => toolPolicy(ctx.policy, u.name) === undefined);
  return { tools: [...new Set(unknown.map((u) => u.name))], seqs: unknown.map((u) => u.seq) };
}

/** Whether the record has any tool call, which is what makes "nothing was attempted" something it can prove. */
function hasToolCalls(ev: Evidence): boolean {
  return ev.items.some((it) => it.kind === "tool_call");
}

/** The calls and results a backing rests on, in order. A call with no result is just the call. */
function seqsOf(backing: Backing | undefined): number[] {
  if (!backing) return [];
  return backing.flatMap((c) => (c.resultSeq === null ? [c.callSeq] : [c.callSeq, c.resultSeq])).sort((a, b) => a - b);
}

/** The most recent change, as a backing of its own. */
function latest(changes: ToolUse[]): Backing | undefined {
  const last = changes.reduce<ToolUse | undefined>((w, c) => (w === undefined || c.callSeq > w.callSeq ? c : w), undefined);
  return last ? [last] : undefined;
}

/**
 * The most recent backing for a claim of this kind: a change of the kind (or of no kind), and for a reschedule also a
 * book that follows a cancel. How recent a backing is comes from its last call.
 */
function backingFor(kind: ChangeKind, changes: ToolUse[]): Backing | undefined {
  const options: Backing[] = changes.filter((c) => c.kind === kind || c.kind === undefined).map((c) => [c]);
  if (kind === "reschedule") {
    for (const book of changes.filter((c) => c.kind === "book")) {
      const cancel = latest(changes.filter((c) => c.kind === "cancel" && c.callSeq < book.callSeq));
      if (cancel) options.push([...cancel, book]);
    }
  }
  return options.reduce<Backing | undefined>((w, o) => (w === undefined || o.at(-1)!.callSeq > w.at(-1)!.callSeq ? o : w), undefined);
}
