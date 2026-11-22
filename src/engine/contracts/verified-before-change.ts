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
//   - the policy was inferred (the call used a check, but only after the change or without success): unverified, since
//     only a described policy shows what the agent was meant to do.
// The contract applies only when we know the agent is meant to verify: a policy that isn't inferred (a preset) and names
// an identity check tool, or a call that used one. Otherwise it is not_applicable, with no note or reason.
// Nothing is violated on shaky evidence, as in the other contracts: a gap that touches the change or a check, ordering
// none, an identity check whose result doesn't say whether it worked, or a tool the policy doesn't describe used
// before the change (it might have been the check) makes the finding unverified.
import type { ChangeKind, Evidence, Finding, GapCode } from "@/report/schema";
import { toolCalls, type ToolUse } from "../committed";
import { readPath } from "../paths";
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
  // It applies only when we know the agent is meant to verify: a described policy that names an identity check tool,
  // or a call that used one. Otherwise there is nothing to hold it to: not applicable, with no note.
  const knowsVerify = (ctx.policySource !== "inferred" && hasVerifyTool(ctx)) || toolCalls(ctx.ev, ctx.policy, "verify").length > 0;
  if (!knowsVerify) return { contract: "verified_before_change", result: "not_applicable", findings: [] };
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

  if (worked.length > 0) return finding("passed", verifiedBeforePassedText(time, change.kind, samePatient(ctx, change, worked.at(-1)!)), did);

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

  // Only a described policy (a preset) can show the agent skipped a check it was meant to make. With an inferred one we
  // know the agent verifies, since the call used a check, but not that this check was due before this change.
  if (ctx.policySource === "inferred" || !hasVerifyTool(ctx)) {
    return finding("unverified", unverifiedText("verified_before_change", [REASONS.verify_not_before]), did);
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

/** Whether the policy names an identity check tool. */
function hasVerifyTool(ctx: ContractContext): boolean {
  return Object.values(ctx.policy.tools).some((t) => t.role === "verify");
}

/** Whether the policy names the patient on both calls and they are the same one: the check was for who the change is for. */
function samePatient(ctx: ContractContext, change: ToolUse, check: ToolUse): boolean {
  const changePath = toolPolicy(ctx.policy, change.tool)?.patientId;
  const checkPath = toolPolicy(ctx.policy, check.tool)?.patientId;
  if (changePath === undefined || checkPath === undefined) return false;
  const a = readPath(changePath, { args: change.args, result: change.result });
  const b = readPath(checkPath, { args: check.args, result: check.result });
  return (typeof a === "string" || typeof a === "number") && a !== "" && String(a) === String(b);
}
