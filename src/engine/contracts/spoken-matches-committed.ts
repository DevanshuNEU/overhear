// Contract 3, spoken_matches_committed (spec 6.4 item 3): the first completion claim after each successful change,
// and before the next change, must state what that change committed, field by field.
//
// One finding per successful change, paired with that change's own first claim: the completion sentences of the
// first agent turn after the change that has any (a vague "you're all set" beside a clear "I booked Friday at 2" is
// read together, so the clear one is not lost). Failed changes are ignored, so a retried booking is compared with
// the one that worked, and the next change that did not fail ends a change's window. A change that committed
// nothing to compare (a cancellation with no details) has no finding.
//
// Nothing is violated on shaky evidence. Only a field that was spoken AND resolved AND different is violated. A
// required field that is unresolved, or resolved but never said, is unverified, and so is any gap that touches the
// claim or the change, or ordering none. A committed value Retell scrubbed, or that is an object or a list, is
// unresolved: it is never compared and never printed. An optional field is listed as unresolved only when the agent
// actually said it, so a call stored with names scrubbed does not come out unverified for a provider nobody named.
//
// The pipeline adds the unresolved_committed_detail gaps from committedDetails to the evidence before contracts run,
// so a finding that names that code finds it there. This contract reads those fields from committedDetails itself
// and so does not need the gap to decide.
import type { Detection, FieldCheck, Finding, GapCode } from "@/report/schema";
import { committedDetails, type FieldType, type ToolUse } from "../committed";
import { REASONS, describeGap, fillText, spokenPassedText, spokenViolatedText, unverifiedText, type GapText } from "../wording";
import { fieldCheck, type MatchContext } from "../spoken";
import { gapsTouching, worst, type Contract, type ContractContext } from "./common";

export const spokenMatchesCommitted: Contract = (ctx) => {
  const { ev } = ctx;
  const unordered = ev.ordering === "none" && ev.items.some((it) => it.kind === "tool_call");
  const claims = ctx.detections.filter((d) => d.cls === "completion").sort((a, b) => a.seq - b.seq);
  const ordered = [...ctx.changes].sort((a, b) => a.callSeq - b.callSeq);
  const findings = ordered
    .filter((c) => c.ok === true)
    .flatMap((change) => {
      const details = committedDetails(ev, ctx.policy, change);
      // Nothing resolved and nothing needed: there is no detail to say or to check.
      if (Object.keys(details.fields).length === 0 && details.unresolved.length === 0) return [];
      const next = ordered.find((c) => c.callSeq > change.callSeq && c.ok !== false);
      const window = unordered ? claims : claims.filter((d) => d.seq > change.callSeq && (next === undefined || d.seq < next.callSeq));
      return [judge(ctx, change, details, window, unordered)];
    });
  return { contract: "spoken_matches_committed", result: worst(findings.map((f) => f.result)), findings };
};

/** One field's row, with whether the change needed that field. */
interface Row {
  check: FieldCheck;
  required: boolean;
}

function judge(ctx: ContractContext, change: ToolUse, details: ReturnType<typeof committedDetails>, window: Detection[], unordered: boolean): Finding {
  const { ev } = ctx;
  const kind = change.kind;
  const did = [...new Set([...details.sources, change.callSeq, ...(change.resultSeq === null ? [] : [change.resultSeq])])].sort((a, b) => a - b);
  const touching = (seqs: number[]) => gapsTouching(ev, "spoken_matches_committed", seqs).filter((g) => g.code !== "unresolved_committed_detail");
  const unverified = (said: number[], causes: GapText[], gaps: GapCode[], fields: FieldCheck[]): Finding => ({
    result: "unverified",
    text: unverifiedText("spoken_matches_committed", causes),
    said,
    did,
    asked: [],
    gaps: [...new Set(gaps)],
    fields,
  });

  // The first agent turn after the change that holds a completion claim, with every completion sentence in it.
  const turn = window.length > 0 ? window[0].seq : undefined;
  const sentences = turn === undefined ? [] : window.filter((d) => d.seq === turn).map((d) => d.quote);

  const evidenceGaps = touching([...(turn === undefined ? [] : [turn]), ...did]);
  const gapCauses = evidenceGaps.map((g) => describeGap(g, { tool: change.tool, kind }));
  const gapCodes = evidenceGaps.map((g) => g.code);

  if (unordered) {
    // With no order, "after the change" means nothing: any claim might be about any change. Only no claim at all is certain.
    if (window.length === 0) return unverified([], [...gapCauses, noClaim(kind)], gapCodes, []);
    return unverified([], [...gapCauses, REASONS.order_unknown], gapCodes, []);
  }
  if (turn === undefined) return unverified([], [...gapCauses, noClaim(kind)], gapCodes, []);

  const text = sentences.join(" ");
  const match: MatchContext = { callStartMs: ev.callStartMs, tz: ctx.tz, policyTz: ctx.policyTz, otherNames: ctx.providerNames };
  const rows = fieldRows(details, text, match);
  const fields = rows.map((r) => r.check);

  const differs = rows.filter((r) => r.check.status === "differs");
  const causes: GapText[] = [...gapCauses];
  const codes: GapCode[] = [...gapCodes];
  for (const r of rows) {
    if (r.check.status === "unresolved") {
      causes.push(describeGap({ code: "unresolved_committed_detail", field: r.check.field, kind, tool: change.tool }));
      if (details.gaps.some((g) => g.field === r.check.field)) codes.push("unresolved_committed_detail");
    } else if (r.check.status === "not_spoken" && r.required) {
      causes.push({ missing: fillText(REASONS.field_not_spoken.missing, { field: r.check.field }), fix: REASONS.field_not_spoken.fix });
    }
  }

  // A violation rests on the claim and the change being sound. Any gap touching them, or a conflict, makes it unverified.
  if (differs.length > 0 && gapCauses.length === 0) {
    const said = rows.filter((r) => r.check.status === "differs" || r.check.status === "match");
    const spoken = phrase(said.map((r) => ({ field: r.check.field, type: r.check.type, text: r.check.status === "differs" ? r.check.values.join(" or ") : r.check.committed! })));
    const committed = phrase(said.map((r) => ({ field: r.check.field, type: r.check.type, text: r.check.committed! })));
    return { result: "violated", text: spokenViolatedText(spoken, committed), said: [turn], did, asked: [], gaps: [], fields };
  }
  if (causes.length > 0) return unverified([turn], causes, codes, fields);

  const checked = rows.filter((r) => r.check.status === "match");
  return {
    result: "passed",
    text: spokenPassedText(phrase(checked.map((r) => ({ field: r.check.field, type: r.check.type, text: r.check.committed! })))),
    said: [turn],
    did,
    asked: [],
    gaps: [],
    fields,
  };
}

/** The unverified cause for a change nobody confirmed. */
function noClaim(kind: ToolUse["kind"]): GapText {
  return { missing: fillText(REASONS.no_claim.missing, { kind }), fix: REASONS.no_claim.fix };
}

/**
 * The rows of a finding, in the policy's field order. A field the change needs always has a row. An optional field
 * has one when its committed value resolved, or when the agent said something of that type, since a value that was
 * said and can't be checked is worth showing; otherwise it is left out.
 */
function fieldRows(details: ReturnType<typeof committedDetails>, text: string, match: MatchContext): Row[] {
  const required = new Set(details.required);
  const rows: Row[] = [];
  for (const [field, type] of Object.entries(details.types) as [string, FieldType][]) {
    const resolved = Object.hasOwn(details.fields, field);
    const check = fieldCheck(field, type, text, resolved ? details.fields[field] : undefined, match);
    const needed = required.has(field);
    if (!needed && check.status === "unresolved" && check.values.length === 0) continue;
    rows.push({ check, required: needed });
  }
  return rows;
}

/**
 * Field values as one phrase, in the policy's field order: the date and time together ("Friday, November 6 at 2:00
 * PM"), then the name ("with Dr. Priya Nair"), then any other field behind its own name.
 */
function phrase(parts: { field: string; type: FieldType; text: string }[]): string {
  const of = (...types: FieldType[]) => parts.filter((p) => types.includes(p.type)).map((p) => p.text);
  const when = [...of("datetime"), [of("date").join(", "), of("time").join(", ")].filter(Boolean).join(" at ")].filter(Boolean).join(", ");
  const names = of("name");
  const others = parts.filter((p) => !["date", "time", "datetime", "name"].includes(p.type)).map((p) => `${p.field} ${p.text}`);
  return [[when, names.length > 0 ? `with ${names.join(" and ")}` : ""].filter(Boolean).join(" "), ...others].filter(Boolean).join(", ");
}
