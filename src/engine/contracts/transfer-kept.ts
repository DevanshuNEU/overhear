// Contract 4, transfer_kept (spec 6.4 item 4): when the agent says it is transferring the caller, a transfer must be
// attempted and must work. Success comes from the transfer tool's result or from a transfer_target event, the
// receiving side's first words. Retell's disconnection_reason values are not read in M1.
//
// One finding per agent turn that carries a transfer claim, and one violated finding per turn that reads a tool
// command out loud, whether or not a transfer was claimed. Offers, conditionals and deferrals are not claims: the
// speech detector already leaves them out.
//
// A claim is judged on the transfer attempts after it. When none come after, an attempt before it counts: the call
// may have gone through just before the agent announced it. Any attempt that worked backs the claim. A transfer_target
// event backs an attempt whose result is missing or silent, and says nothing against a result that failed.
//
// Nothing is violated on shaky evidence (the same rules as promise_backed): a gap that touches the claim or the
// attempt, ordering none, a tool the policy doesn't describe that ran after the claim, or a record with no tool calls
// at all makes the finding unverified. One rule is this contract's own: with an inferred policy that has no transfer
// tool, a missing transfer can't be told apart from one that went through a tool we did not recognise, so such a claim
// is unverified. Only the preset, which lists every tool its agent has, gives violated for it.
import type { Detection, Evidence, Finding, GapCode } from "@/report/schema";
import { toolCalls, type ToolUse } from "../committed";
import { toolPolicy } from "../policy";
import {
  REASONS,
  describeGap,
  formatTime,
  toolSyntaxText,
  transferPassedText,
  transferViolatedText,
  unknownTransferToolCause,
  unverifiedText,
  fillText,
  type GapText,
} from "../wording";
import { gapsTouching, softenForMissingTools, worst, type Contract, type ContractContext } from "./common";

export const transferKept: Contract = (ctx) => {
  const claimTurns = [...new Set(ctx.detections.filter((d) => d.cls === "transfer").map((d) => d.seq))];
  const syntax = ctx.detections.filter((d) => d.cls === "tool_syntax");
  const findings = [...claimTurns.map((seq) => judge(ctx, seq)), ...syntax.map((d) => syntaxFinding(ctx, d))].sort((a, b) => a.said[0] - b.said[0]);
  return { contract: "transfer_kept", result: worst(findings.map((f) => f.result)), findings };
};

/**
 * A tool command read out loud is wrong whatever came of any transfer, so it needs no record of calls. The one thing
 * that stops it being violated is ordering none: the report schema allows no violated finding from this contract then.
 */
function syntaxFinding(ctx: ContractContext, d: Detection): Finding {
  if (ctx.ev.ordering === "none") {
    return { result: "unverified", text: unverifiedText("transfer_kept", [REASONS.order_unknown]), said: [d.seq], did: [], asked: [], gaps: [], fields: [] };
  }
  return { result: "violated", text: toolSyntaxText(formatTime(d.seq, ctx.ev), d.quote), said: [d.seq], did: [], asked: [], gaps: [], fields: [] };
}

/** What the attempts one claim rests on add up to. */
type Outcome =
  | { kind: "worked"; did: number[] }
  | { kind: "failed"; did: number[] }
  /** A call whose success can't be told: no result, or a result that doesn't say. */
  | { kind: "unsettled"; did: number[]; tool: string; noResult: boolean }
  | { kind: "none" };

/** Judges the transfer claim made at one agent turn. */
function judge(ctx: ContractContext, seq: number): Finding {
  const { ev } = ctx;
  // With ordering none the seqs say nothing about what came first, so nothing is "before" or "after" anything.
  const unordered = ev.ordering === "none" && hasToolCalls(ev);
  const time = formatTime(seq, ev);
  const base = { said: [seq], asked: [], fields: [] };
  const finding = (result: Finding["result"], text: string, did: number[], gaps: GapCode[] = []): Finding => ({ ...base, result, text, did, gaps });

  const outcome = outcomeOf(ctx, seq, unordered);
  const did = outcome.kind === "none" ? [] : outcome.did;

  const touching = gapsTouching(ev, "transfer_kept", [seq, ...did]);
  const causes: GapText[] = touching.map((g) => describeGap(g, { tool: outcome.kind === "unsettled" ? outcome.tool : undefined }));
  if (unordered) causes.push(REASONS.order_unknown);
  if (causes.length > 0) {
    const gaps: GapCode[] = [...new Set(touching.map((g) => g.code))];
    return finding("unverified", unverifiedText("transfer_kept", causes), did, gaps);
  }

  switch (outcome.kind) {
    case "worked":
      return finding("passed", transferPassedText(time), did);
    case "failed":
      return finding("violated", transferViolatedText(time, "failed"), did);
    case "unsettled": {
      const cause = outcome.noResult
        ? { missing: fillText(REASONS.transfer_no_result.missing, { tool: outcome.tool }), fix: REASONS.transfer_no_result.fix }
        : describeGap({ code: "unknown_success", tool: outcome.tool });
      return finding("unverified", unverifiedText("transfer_kept", [cause]), did);
    }
    case "none": {
      // A tool the policy doesn't describe might have been the transfer, so nothing here proves one wasn't attempted.
      const unknown = undescribedAfter(ctx, seq);
      if (unknown.tools.length > 0) {
        return finding("unverified", unverifiedText("transfer_kept", [unknownTransferToolCause(unknown.tools)]), unknown.seqs);
      }
      if (ctx.policySource === "inferred" && !hasTransferTool(ctx)) {
        return finding("unverified", unverifiedText("transfer_kept", [REASONS.no_transfer_tool]), []);
      }
      return softenForMissingTools(ev, finding("violated", transferViolatedText(time, "not_attempted"), []), "transfer_kept");
    }
  }
}

/** The transfer attempts that stand behind a claim at seq, and what they add up to. */
function outcomeOf(ctx: ContractContext, seq: number, unordered: boolean): Outcome {
  const calls = toolCalls(ctx.ev, ctx.policy, "transfer");
  const events = ctx.ev.items.filter((it) => it.kind === "event" && it.type === "transfer_target").map((it) => it.seq);
  const after = { calls: calls.filter((c) => c.callSeq > seq), events: events.filter((e) => e > seq) };
  const before = { calls: calls.filter((c) => c.callSeq < seq), events: events.filter((e) => e < seq) };
  const pick = unordered ? { calls, events } : after.calls.length + after.events.length > 0 ? after : before;

  const worked = pick.calls.filter((c) => c.ok === true);
  if (worked.length > 0) return { kind: "worked", did: callSeqs(worked.slice(-1)) };
  // An event stands in for the result of a call that has none or says nothing, and for a call nobody logged.
  const silent = pick.calls.filter((c) => c.ok === null);
  if (pick.events.length > 0 && (silent.length > 0 || pick.calls.length === 0)) {
    return { kind: "worked", did: [...callSeqs(silent.slice(-1)), pick.events[0]].sort((a, b) => a - b) };
  }
  if (silent.length > 0) {
    const last = silent[silent.length - 1];
    return { kind: "unsettled", did: callSeqs([last]), tool: last.tool, noResult: last.resultSeq === null };
  }
  if (pick.calls.length > 0) return { kind: "failed", did: callSeqs(pick.calls.slice(-1)) };
  return { kind: "none" };
}

/** The calls and results of these uses, in order. A call with no result is just the call. */
function callSeqs(uses: ToolUse[]): number[] {
  return uses.flatMap((c) => (c.resultSeq === null ? [c.callSeq] : [c.callSeq, c.resultSeq])).sort((a, b) => a - b);
}

/** The tools used after a claim that the policy gives no role, in order of first use, with the seqs of their calls. */
function undescribedAfter(ctx: ContractContext, seq: number): { tools: string[]; seqs: number[] } {
  const used = ctx.ev.items.flatMap((it) => {
    if (it.seq <= seq) return [];
    if (it.kind === "tool_call") return [{ seq: it.seq, id: it.id, name: it.name }];
    if (it.kind === "backend_action") return [{ seq: it.seq, id: it.toolCallId, name: it.tool }];
    return [];
  });
  const unknown = used.filter((u) => toolPolicy(ctx.policy, u.name) === undefined);
  // A tool call's result is part of what the call did, so cite it with the call.
  const results = ctx.ev.items.flatMap((it) => (it.kind === "tool_result" && unknown.some((u) => u.id === it.id) ? [it.seq] : []));
  return {
    tools: [...new Set(unknown.map((u) => u.name))],
    seqs: [...new Set([...unknown.map((u) => u.seq), ...results])].sort((a, b) => a - b),
  };
}

/** Whether the policy names a tool that transfers. */
function hasTransferTool(ctx: ContractContext): boolean {
  return Object.values(ctx.policy.tools).some((t) => t.role === "transfer");
}

/** Whether the record has any tool call, which is what makes "nothing was attempted" something it can prove. */
function hasToolCalls(ev: Evidence): boolean {
  return ev.items.some((it) => it.kind === "tool_call");
}
