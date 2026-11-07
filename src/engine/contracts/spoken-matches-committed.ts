// Contract 3, spoken_matches_committed (spec 6.4 item 3): the first completion claim after each successful change,
// and before the next change, must state what that change committed, field by field.
//
// One finding per successful change, paired with that change's own first claim: the first agent turn after the
// change with a completion sentence about that change (its kind, no kind, or a reschedule for a book or cancel).
// Each such sentence is checked on its own, then the fields are combined: differs if any sentence differs (the
// caller heard a wrong value), match if one matches and none differs, not_spoken if none says it. Sentences are never
// joined, so one can't bleed into the next. Failed changes are ignored, so a retried booking is compared with the one
// that worked, and the next change that did not fail ends a change's window. A change that committed nothing to
// compare (a cancellation with no details) has a finding only when nobody confirmed it: no claim, unverified. A
// cancellation straight before a booking is not asked for its own claim; the booking's confirmation covers a
// reschedule.
//
// A policy with no zone (inferred) reads a committed time in the zone the check ran in, and a spoken date or time
// that differs there but fits another plausible zone (UTC, or the slot's own offset) is unverified, with the zone
// named, never violated. A preset zone is read in that zone only.
//
// Nothing is violated on shaky evidence. Only a field that was spoken AND resolved AND different is violated. A
// required field that is unresolved, or resolved but never said, is unverified, and so is any gap that touches the
// claim or the change, or ordering none. A committed value Retell scrubbed, or that is an object or a list, is
// unresolved: it is never compared and never printed. An optional field is listed as unresolved only when the agent
// actually said it, so a call stored with names scrubbed does not come out unverified for a provider nobody named.
//
// The pipeline adds the unresolved_committed_detail gaps from committedDetails to the evidence before contracts run.
// This contract reads those fields from committedDetails itself and so does not need the gap to decide; it cites the
// code in a finding only when the evidence holds that gap.
import type { Detection, FieldCheck, Finding, GapCode } from "@/report/schema";
import { committedDetails, type FieldType, type ToolUse } from "../committed";
import { REASONS, describeGap, fillText, spokenPassedText, spokenViolatedText, unverifiedText, zoneUnsureCause, type GapText } from "../wording";
import { fieldCheckZoned, type MatchContext, type ZoneDoubt } from "../spoken";
import { gapsTouching, worst, type Contract, type ContractContext } from "./common";

type Details = ReturnType<typeof committedDetails>;

export const spokenMatchesCommitted: Contract = (ctx) => {
  const { ev } = ctx;
  const unordered = ev.ordering === "none" && ev.items.some((it) => it.kind === "tool_call");
  const completions = ctx.detections.filter((d) => d.cls === "completion").sort((a, b) => a.seq - b.seq);
  const ordered = [...ctx.changes].sort((a, b) => a.callSeq - b.callSeq);
  const findings = ordered
    .filter((c) => c.ok === true)
    .flatMap((change) => {
      const details = committedDetails(ev, ctx.policy, change);
      const next = ordered.find((c) => c.callSeq > change.callSeq && c.ok !== false);
      const window = completions.filter((d) => aboutChange(d, change) && (unordered || (d.seq > change.callSeq && (next === undefined || d.seq < next.callSeq))));
      const nothingToCompare = Object.keys(details.fields).length === 0 && details.unresolved.length === 0;
      if (nothingToCompare) {
        // Nothing to say or check, so a confirmation needs no finding. No confirmation at all is still unverified,
        // except a cancellation that a booking follows at once: that booking's confirmation covers the reschedule.
        if (window.length > 0) return [];
        if (change.kind === "cancel" && next?.kind === "book" && next.ok === true) return [];
      }
      return [judge(ctx, change, details, window, unordered)];
    });
  return { contract: "spoken_matches_committed", result: worst(findings.map((f) => f.result)), findings };
};

/** Whether a completion sentence can be about this change: its kind, no kind, or a reschedule for a book or cancel. */
function aboutChange(d: Detection, change: ToolUse): boolean {
  if (d.kind === undefined || change.kind === undefined || d.kind === change.kind) return true;
  return d.kind === "reschedule" && (change.kind === "book" || change.kind === "cancel");
}

/** One field's row, with whether the change needed that field and what the sentences that differed said. */
interface Row {
  check: FieldCheck;
  required: boolean;
  /** The values of the sentences that differ from what was committed. */
  wrong: string[];
  /** Set when the words fit the committed value only in another plausible zone: what was said, and the two readings. */
  zone?: { doubt: ZoneDoubt; said: string[] };
}

function judge(ctx: ContractContext, change: ToolUse, details: Details, window: Detection[], unordered: boolean): Finding {
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

  // The first agent turn with a claim about this change, and each of its claim sentences.
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

  const match: MatchContext = { callStartMs: ev.callStartMs, tz: ctx.tz, policyTz: ctx.policyTz, otherNames: ctx.providerNames };
  const rows = fieldRows(details, sentences, match);
  const fields = rows.map((r) => r.check);

  const differs = rows.filter((r) => r.check.status === "differs");
  const causes: GapText[] = [...gapCauses];
  const codes: GapCode[] = [...gapCodes];
  for (const r of rows) {
    if (r.zone) {
      const type = r.check.type as "date" | "time" | "datetime";
      causes.push(zoneUnsureCause({ said: r.zone.said.join(" or "), kind, type, doubt: r.zone.doubt }));
    } else if (r.check.status === "unresolved") {
      causes.push(describeGap({ code: "unresolved_committed_detail", field: r.check.field, kind, tool: change.tool }));
      // Cite the code only when the evidence holds that gap, whatever the pipeline added.
      if (ev.gaps.some((g) => g.code === "unresolved_committed_detail" && g.field === r.check.field && g.seqs.includes(change.callSeq))) {
        codes.push("unresolved_committed_detail");
      }
    } else if (r.check.status === "not_spoken" && r.required) {
      causes.push({ missing: fillText(REASONS.field_not_spoken.missing, { field: r.check.field }), fix: REASONS.field_not_spoken.fix });
    }
  }

  // A violation rests on the claim and the change being sound. Any gap touching them, or a conflict, makes it unverified.
  if (differs.length > 0 && gapCauses.length === 0) {
    const said = rows.filter((r) => r.check.status === "differs" || r.check.status === "match");
    const spoken = phrase(said.map((r) => ({ field: r.check.field, type: r.check.type, text: r.check.status === "differs" ? r.wrong.join(" or ") : r.check.committed! })));
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
 * The rows of a finding, in the policy's field order, from each claim sentence checked on its own and combined per
 * field: differs when any sentence differs, match when one matches and none differs, otherwise not_spoken (or
 * unresolved when the committed value can't be used). A row's values are those of every sentence, in order, with
 * repeats dropped. A field the change needs always has a row, including one the policy has no definition for (an
 * unresolved string). An optional field has one when its committed value resolved, or when the agent said something
 * of that type, since a value that was said and can't be checked is worth showing; otherwise it is left out.
 */
function fieldRows(details: Details, sentences: string[], match: MatchContext): Row[] {
  const required = new Set(details.required);
  const rows: Row[] = [];
  for (const [field, type] of Object.entries(details.types) as [string, FieldType][]) {
    const committed = Object.hasOwn(details.fields, field) ? details.fields[field] : undefined;
    const zoned = sentences.map((s) => fieldCheckZoned(field, type, s, committed, match));
    const checks = zoned.map((z) => z.check);
    const values = [...new Set(checks.flatMap((c) => c.values))];
    const wrong = [...new Set(checks.filter((c) => c.status === "differs").flatMap((c) => c.values))];
    // A sentence that fits only another plausible zone is a doubt, not a difference: it loses to a sentence that
    // differs or matches, and it beats a sentence that says nothing.
    const doubt = zoned.find((z) => z.zone !== undefined);
    const status: FieldCheck["status"] = checks.some((c) => c.status === "differs")
      ? "differs"
      : checks.some((c) => c.status === "match")
        ? "match"
        : doubt
          ? "unresolved"
          : checks[0].status;
    const needed = required.has(field);
    if (!needed && status === "unresolved" && values.length === 0) continue;
    const zone = status === "unresolved" && doubt?.zone ? { doubt: doubt.zone, said: doubt.check.values } : undefined;
    // The doubt's own sentence carries the committed value the check read; every sentence reads the same one.
    rows.push({ check: { ...(doubt && status === "unresolved" ? doubt.check : checks[0]), values, status }, required: needed, wrong, zone });
  }
  // A field the change needs that the policy never defined has no value anywhere: it can only be unresolved.
  for (const field of details.required) {
    if (!Object.hasOwn(details.types, field)) {
      rows.push({ check: { field, type: "string", from: "spoken", values: [], committed: null, status: "unresolved" }, required: true, wrong: [] });
    }
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
