// Tool calls, changes and committed details (Tier 1, spec 6.1 and 6.5).
//
// The tool calls in a record, paired with their results; the ones that change something; and, for each change,
// the date, time and provider it committed. Tier 1 has no backend log, so a change's own arguments and result are
// all it says about itself. The slot's date, time and provider live in the lookup that offered the slot, so an
// item. field is read from the most recent earlier successful lookup whose item id equals the change's id (an exact
// match first, then one that ignores letter case). A detail that can't be read, or that Retell scrubbed to a placeholder, is unresolved and says so in a gap: it is never guessed, and
// never compared.
import type { ChangeKind, Evidence, Gap, Policy } from "@/report/schema";
import { readPath, type PathRoots } from "./paths";
import { pairToolItems } from "./pairing";
import { isPlaceholder } from "./placeholder";
import { toolPolicy, type ToolPolicy } from "./policy";
import { unresolvedDetail, type UnresolvedWhy } from "./wording";

export type Role = ToolPolicy["role"];
export type FieldType = Policy["fields"][string]["type"];

/** One tool call and the result that answers it. resultSeq, ok and result are null when no result came back. */
export interface ToolUse {
  callSeq: number;
  resultSeq: number | null;
  toolCallId: string;
  tool: string;
  role: Role;
  kind?: ChangeKind;
  /** The success resolveOk settled on, so call resolveOk first: null when unsettled or when there is no result. */
  ok: boolean | null;
  args: Record<string, unknown>;
  result: unknown;
}

/**
 * The calls to tools the policy gives this role, in the order they were made. A tool the policy does not name has
 * no role and is left out. Results are paired by pairToolItems, the rule resolveOk uses too.
 */
export function toolCalls(ev: Evidence, policy: Policy, role: Role): ToolUse[] {
  const pairing = pairToolItems(ev.items);
  return pairing.calls.flatMap((call): ToolUse[] => {
    const tp = toolPolicy(policy, call.name);
    if (tp?.role !== role) return [];
    const result = pairing.resultOf(call);
    const use: ToolUse = {
      callSeq: call.seq,
      resultSeq: result?.seq ?? null,
      toolCallId: call.id,
      tool: call.name,
      role,
      ok: result?.ok ?? null,
      args: call.args,
      result: result ? result.payload : null,
    };
    if (tp.kind) use.kind = tp.kind;
    return [use];
  });
}

/** The calls that change something: book, cancel, reschedule and update tools. */
export function changes(ev: Evidence, policy: Policy): ToolUse[] {
  return toolCalls(ev, policy, "change");
}

/** The changes known to have worked. A failed change and one whose success is unknown are dropped. */
export function successfulChanges(list: ToolUse[]): ToolUse[] {
  return list.filter((c) => c.ok === true);
}

/** What one change committed. fields holds only values that resolved; types names every field the policy has. */
export interface CommittedDetails {
  fields: Record<string, unknown>;
  types: Record<string, FieldType>;
  /** Fields the change needed and could not resolve, plus any field the record had but Retell scrubbed. */
  unresolved: string[];
  gaps: Gap[];
}

/**
 * The details a change committed, field by field, from the policy's field paths. item. paths read the item the
 * change picked, found in the most recent earlier lookup that offered an item with the change's id (a lookup that
 * failed does not count). args., result. and call. paths read the change itself and the call's fields. A field is
 * required when the tool's required list names it; with no list, when the field's own required flag is set; a
 * list of [] makes none required. A required field with no value is unresolved; so is any field whose value is a
 * redaction placeholder. Each unresolved field has an unresolved_committed_detail gap. Throws InputError for a
 * malformed policy path.
 */
export function committedDetails(ev: Evidence, policy: Policy, change: ToolUse): CommittedDetails {
  const tp = toolPolicy(policy, change.tool);
  const roots: PathRoots = { args: change.args, result: change.result, call: ev.callFields };
  const required = new Set(tp?.required ?? Object.entries(policy.fields).flatMap(([name, f]) => (f.required ? [name] : [])));

  let picked: unknown;
  let searched = false;
  const item = () => {
    if (!searched) {
      searched = true;
      picked = pickedItem(ev, policy, change, tp?.id !== undefined ? readPath(tp.id, roots) : undefined);
    }
    return picked;
  };

  const fields: Record<string, unknown> = {};
  const types: Record<string, FieldType> = {};
  const unresolved: { field: string; why: UnresolvedWhy }[] = [];
  for (const [name, f] of Object.entries(policy.fields)) {
    types[name] = f.type;
    const value = f.path.split(".")[0] === "item" ? readItem(f.path, item()) : readPath(f.path, roots);
    if (isBlank(value)) {
      if (required.has(name)) unresolved.push({ field: name, why: "no_source" });
    } else if (isPlaceholder(value)) {
      unresolved.push({ field: name, why: "scrubbed" });
    } else {
      fields[name] = value;
    }
  }
  for (const name of required) {
    if (!Object.hasOwn(policy.fields, name)) unresolved.push({ field: name, why: "no_source" });
  }

  const seqs = change.resultSeq === null ? [change.callSeq] : [change.callSeq, change.resultSeq];
  const gaps = unresolved.map(({ field, why }): Gap => {
    const gap: Gap = { code: "unresolved_committed_detail", detail: unresolvedDetail(field, change.tool, why), seqs: [...seqs], tool: change.tool, field };
    if (change.kind) gap.kind = change.kind;
    return gap;
  });
  return { fields, types, unresolved: unresolved.map((u) => u.field), gaps };
}

/**
 * The distinct provider names the record knows, in order of first appearance: every name-typed field read from the
 * lookups' items (failed lookups skipped) and from the changes. The speech detector reads these to spot a provider
 * the agent names. Scrubbed and blank names are left out.
 */
export function providerNames(ev: Evidence, policy: Policy): string[] {
  const nameFields = Object.values(policy.fields).filter((f) => f.type === "name");
  if (nameFields.length === 0) return [];
  const found: unknown[] = [];
  for (const use of toolCalls(ev, policy, "lookup").filter((u) => u.ok !== false)) {
    for (const it of itemsOf(policy, use)) {
      for (const f of nameFields) if (f.path.split(".")[0] === "item") found.push(readPath(f.path, { item: it }));
    }
  }
  for (const use of changes(ev, policy)) {
    const roots: PathRoots = { args: use.args, result: use.result, call: ev.callFields };
    for (const f of nameFields) if (f.path.split(".")[0] !== "item") found.push(readPath(f.path, roots));
  }
  const names = found.flatMap((v) => (typeof v === "string" && !isBlank(v) && !isPlaceholder(v) ? [v.trim()] : []));
  return [...new Set(names)];
}

/**
 * The item the change picked: from the latest earlier successful lookup that offered an item with the change's id.
 * Only a lookup whose ok is true counts: a failed one offers nothing, and so does one whose success is unknown (after
 * resolveOk a lookup with a readable items list is already true, so a null one has no list to read). An id matches
 * exactly first, across every earlier lookup, newest first; only when none matches exactly does a match that
 * ignores letter case count, so ids that differ only in case never pick each other's item when the exact one exists.
 */
function pickedItem(ev: Evidence, policy: Policy, change: ToolUse, changeId: unknown): unknown {
  const wanted = idKey(changeId);
  if (wanted === null) return undefined;
  const earlier = toolCalls(ev, policy, "lookup")
    .filter((u) => u.resultSeq !== null && u.resultSeq < change.callSeq && u.ok === true)
    .sort((a, b) => b.resultSeq! - a.resultSeq!);
  for (const exact of [true, false]) {
    for (const use of earlier) {
      const idPath = toolPolicy(policy, use.tool)?.id;
      if (idPath === undefined) continue;
      const hit = itemsOf(policy, use).find((it) => {
        const key = idKey(readPath(idPath, { item: it }));
        return key !== null && (exact ? key.exact === wanted.exact : key.folded === wanted.folded);
      });
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

/** The items a lookup returned, read from the tool's items path; none when the policy gives no path or it is not a list. */
function itemsOf(policy: Policy, use: ToolUse): unknown[] {
  const path = toolPolicy(policy, use.tool)?.items;
  if (path === undefined) return [];
  const list = readPath(path, { args: use.args, result: use.result });
  return Array.isArray(list) ? list : [];
}

/** One field of the picked item, or undefined when no item was picked. */
function readItem(path: string, picked: unknown): unknown {
  return picked === undefined ? undefined : readPath(path, { item: picked });
}

/**
 * An id as comparable keys: strings and finite numbers by value, ignoring outer spaces. exact keeps the letter case
 * and folded drops it. Anything else, or a placeholder, has none.
 */
function idKey(v: unknown): { exact: string; folded: string } | null {
  if (typeof v !== "string" && !(typeof v === "number" && Number.isFinite(v))) return null;
  const s = String(v).trim();
  return s === "" || isPlaceholder(s) ? null : { exact: s, folded: s.toLowerCase() };
}

/** Nothing to read: missing, null, or an empty or whitespace string. */
function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}
