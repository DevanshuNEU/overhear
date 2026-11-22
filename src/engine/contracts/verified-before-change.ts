// Contract 2, verified_before_change (spec 6.4 item 2): a call that books, cancels or reschedules for someone must have
// checked who was calling first. For each such change that worked, a tool the policy calls an identity check must
// have succeeded, with its result in, before the change was called, in this call.
//
// One finding per successful book, cancel or reschedule. A change that failed changed nothing, and an update (or a
// change the policy gives no kind) is not asked for an identity check: not every update needs one, so asking would
// invite false failures. With a successful check before the change the finding passes. With none:
//   - the policy names an identity check tool (a preset lists every tool its agent has; an inferred policy knows the
//     ones the call used): violated, since the agent changed a booking before any check worked. A check that failed,
//     or that ran only after the change, is no check.
//   - the policy names none: unverified. We can't tell how this agent checks who is calling, and it may do so outside
//     the tools we can see.
// Nothing is violated on shaky evidence, as in the other contracts: a gap that touches the change or a check, ordering
// none, an identity check whose result doesn't say whether it worked, or a tool the policy doesn't describe used
// before the change (it might have been the check) makes the finding unverified.
import type { ChangeKind, Evidence, Finding, GapCode } from "@/report/schema";
import { toolCalls, type ToolUse } from "../committed";
import { toolPolicy } from "../policy";
import {
  REASONS,
  describeGap,
  fillText,
  formatTime,
  unknownVerifyToolCause,
  unverifiedText,
  verifiedBeforePassedText,
  verifiedBeforeViolatedText,
  type GapText,
} from "../wording";
import { gapsTouching, softenForMissingTools, worst, type Contract, type ContractContext } from "./common";

/** The kinds of change that need an identity check first. */
const NEEDS_CHECK: readonly (ChangeKind | undefined)[] = ["book", "cancel", "reschedule"];

export const verifiedBeforeChange: Contract = (ctx) => {
  const findings = ctx.changes.filter((c) => c.ok === true && NEEDS_CHECK.includes(c.kind)).map((change) => judge(ctx, change));
  return { contract: "verified_before_change", result: worst(findings.map((f) => f.result)), findings };
};

/** The calls and results of these uses, in order. A call with no result is just the call. */
function seqsOf(uses: ToolUse[]): number[] {
  return [...new Set(uses.flatMap((c) => (c.resultSeq === null ? [c.callSeq] : [c.callSeq, c.resultSeq])))].sort((a, b) => a - b);
}

function judge(ctx: ContractContext, change: ToolUse): Finding {
  const { ev } = ctx;
  const time = formatTime(change.callSeq, ev);
  const unordered = ev.ordering === "none" && ev.items.some((it) => it.kind === "tool_call");
  const checks = toolCalls(ev, ctx.policy, "verify");
  // A check counts only when its result is in before the change is called.
  const before = unordered ? checks : checks.filter((c) => c.callSeq < change.callSeq && (c.resultSeq === null || c.resultSeq < change.callSeq));
  const worked = before.filter((c) => c.ok === true);
  const base = { said: [], asked: [], fields: [] };
  const finding = (result: Finding["result"], text: string, did: number[], gaps: GapCode[] = []): Finding => ({ ...base, result, text, did, gaps });

  const did = seqsOf([...(worked.length > 0 ? worked.slice(-1) : before), change]);
  const touching = gapsTouching(ev, "verified_before_change", did);
  const causes: GapText[] = touching.map((g) => describeGap(g, { tool: before.at(-1)?.tool }));
  if (unordered) causes.push(REASONS.order_unknown);
  if (causes.length > 0) {
    return finding("unverified", unverifiedText("verified_before_change", causes), did, [...new Set(touching.map((g) => g.code))]);
  }

  if (worked.length > 0) return finding("passed", verifiedBeforePassedText(time, change.kind), did);

  // A check whose result doesn't say whether it worked, or has none, is a hole in the record.
  const unsettled = before.find((c) => c.ok === null);
  if (unsettled) {
    const cause =
      unsettled.resultSeq === null
        ? { missing: fillText(REASONS.verify_no_result.missing, { tool: unsettled.tool }), fix: REASONS.verify_no_result.fix }
        : describeGap({ code: "unknown_success", tool: unsettled.tool });
    return finding("unverified", unverifiedText("verified_before_change", [cause]), did);
  }

  // A tool the policy doesn't describe, used before the change, might have been the check.
  const unknown = undescribedBefore(ctx, change.callSeq);
  if (unknown.tools.length > 0) {
    return finding("unverified", unverifiedText("verified_before_change", [unknownVerifyToolCause(unknown.tools)]), [...seqsOf([change]), ...unknown.seqs].sort((a, b) => a - b));
  }

  // A policy that names no identity check tool can't show the agent skipped one.
  if (!Object.values(ctx.policy.tools).some((t) => t.role === "verify")) {
    return finding("unverified", unverifiedText("verified_before_change", [REASONS.no_verify_tool]), did);
  }
  return softenForMissingTools(ev, finding("violated", verifiedBeforeViolatedText(time, change.kind), did), "verified_before_change");
}

/** The tools used before a seq that the policy gives no role, in order of first use, with the seqs of their calls and results. */
function undescribedBefore(ctx: ContractContext, seq: number): { tools: string[]; seqs: number[] } {
  const ev: Evidence = ctx.ev;
  const used = ev.items.flatMap((it) => {
    if (it.seq >= seq) return [];
    if (it.kind === "tool_call") return [{ seq: it.seq, id: it.id, name: it.name }];
    if (it.kind === "backend_action") return [{ seq: it.seq, id: it.toolCallId, name: it.tool }];
    return [];
  });
  const unknown = used.filter((u) => toolPolicy(ctx.policy, u.name) === undefined);
  const results = ev.items.flatMap((it) => (it.kind === "tool_result" && it.seq < seq && unknown.some((u) => u.id === it.id) ? [it.seq] : []));
  return { tools: [...new Set(unknown.map((u) => u.name))], seqs: [...new Set([...unknown.map((u) => u.seq), ...results])].sort((a, b) => a - b) };
}
