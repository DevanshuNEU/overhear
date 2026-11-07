// Tool calls, changes and committed details (Tier 1, spec 6.1 and 6.5).
//
// The tool calls in a record, paired with their results; the ones that change something; and, for each change,
// the date, time and provider it committed. Tier 1 has no backend log, so a change's own arguments and result are
// all it says about itself. The slot's date, time and provider live in the lookup that offered the slot, so an
// item. field is read from the earlier successful lookups whose item id equals the change's id (an exact match
// first, then one that ignores letter case). When more than one such item exists and they disagree on a field the
// change needs, none is picked: the field is unresolved and one gap names every candidate. A detail that can't be
// read, or that Retell scrubbed to a placeholder, is unresolved and says so in a gap: it is never guessed, and
// never compared.
import type { ChangeKind, Evidence, Gap, Policy } from "@/report/schema";
import { readPath, type PathRoots } from "./paths";
import { pairToolItems } from "./pairing";
import { isPlaceholder } from "./placeholder";
import { toolPolicy, type ToolPolicy } from "./policy";
import { formatValue, toLocal } from "./spoken";
import { lookupsDisagreeDetail, unresolvedDetail, type LookupCandidate, type UnresolvedWhy } from "./wording";

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
 * change meant, found in the earlier lookups that offered an item with the change's id (a lookup that failed does
 * not count). When several items carry the id and disagree on a field, that field is read from none of them: if the
 * change needs it, it is unresolved and one gap names each candidate's lookup, result seq and values; if not, it is
 * left out with no gap. args., result. and call. paths read the change itself and the call's fields. A field is
 * required when the tool's required list names it; with no list, when the field's own required flag is set; a
 * list of [] makes none required. A required field with no value is unresolved; so is any field whose value is a
 * redaction placeholder. Each unresolved field has an unresolved_committed_detail gap. Throws InputError for a
 * malformed policy path.
 */
export function committedDetails(ev: Evidence, policy: Policy, change: ToolUse): CommittedDetails {
  const tp = toolPolicy(policy, change.tool);
  const roots: PathRoots = { args: change.args, result: change.result, call: ev.callFields };
  const required = new Set(tp?.required ?? Object.entries(policy.fields).flatMap(([name, f]) => (f.required ? [name] : [])));

  const usesItem = Object.values(policy.fields).some((f) => f.path.split(".")[0] === "item");
  const candidates = usesItem ? candidateItems(ev, policy, change, tp?.id !== undefined ? readPath(tp.id, roots) : undefined) : [];
  const zone = { tz: policy.timezone ?? "UTC", policyTz: policy.timezone !== undefined };
  // The item. fields the candidates disagree on. With one candidate, or none, there is nothing to disagree.
  const disagree = new Set(
    candidates.length < 2
      ? []
      : Object.entries(policy.fields).flatMap(([name, f]) => {
          if (f.path.split(".")[0] !== "item") return [];
          const keys = new Set(candidates.map((c) => comparableKey(f.type, readItem(f.path, c.item), zone)));
          return keys.size > 1 ? [name] : [];
        }),
  );
  // Of the candidates that agree, the latest one's value is read.
  const picked = candidates.at(-1)?.item;

  const fields: Record<string, unknown> = {};
  const types: Record<string, FieldType> = {};
  const unresolved: { field: string; why: UnresolvedWhy | "disagree" }[] = [];
  for (const [name, f] of Object.entries(policy.fields)) {
    types[name] = f.type;
    if (disagree.has(name)) {
      if (required.has(name)) unresolved.push({ field: name, why: "disagree" });
      continue;
    }
    const value = f.path.split(".")[0] === "item" ? readItem(f.path, picked) : readPath(f.path, roots);
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
  const gaps = unresolved.flatMap(({ field, why }): Gap[] => {
    if (why === "disagree") return [];
    const gap: Gap = { code: "unresolved_committed_detail", detail: unresolvedDetail(field, change.tool, why), seqs: [...seqs], tool: change.tool, field };
    if (change.kind) gap.kind = change.kind;
    return [gap];
  });
  if (unresolved.some((u) => u.why === "disagree")) {
    const named = Object.keys(policy.fields).filter((name) => disagree.has(name));
    const said = candidates.map((c): LookupCandidate => ({ tool: c.use.tool, seq: c.use.resultSeq!, said: candidateSaid(policy, named, c.item, zone) }));
    const gap: Gap = {
      code: "unresolved_committed_detail",
      detail: lookupsDisagreeDetail(said),
      seqs: [...new Set([...seqs, ...said.map((c) => c.seq)])].sort((a, b) => a - b),
      tool: change.tool,
      field: named.join(", "),
    };
    if (change.kind) gap.kind = change.kind;
    gaps.push(gap);
  }
  return { fields, types, unresolved: unresolved.map((u) => u.field), gaps };
}

interface Zone {
  tz: string;
  policyTz: boolean;
}

/**
 * A field value as a key for comparing candidates. Dates and times compare as wall-clock values read the way the
 * checker reads them, so one moment written two ways agrees; names and strings ignore letter case and extra
 * spaces. A blank value and a scrubbed one each have their own key, so a candidate missing a field disagrees with
 * one that has it, and two scrubbed ones agree (they are unresolved anyway).
 */
function comparableKey(type: FieldType, value: unknown, zone: Zone): string {
  if (isBlank(value)) return "blank";
  if (isPlaceholder(value)) return "hidden";
  if ((type === "date" || type === "time" || type === "datetime") && typeof value === "string") {
    const local = toLocal(value, zone.tz, zone.policyTz);
    const parts = [type !== "time" ? local.date : undefined, type !== "date" ? local.time : undefined];
    if (parts.some((p) => p !== undefined)) return `at ${parts.join(" ")}`;
  }
  const text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
  return `is ${text.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

/**
 * What one candidate item said for the fields in dispute, in the policy's order: its values, then a name as
 * "with ...". A scrubbed value is named by its field and never repeated; a blank one is left out; nothing at all
 * reads "nothing".
 */
function candidateSaid(policy: Policy, names: string[], item: unknown, zone: Zone): string {
  const plain: string[] = [];
  const withs: string[] = [];
  for (const name of names) {
    const f = policy.fields[name];
    const value = readItem(f.path, item);
    if (isBlank(value)) continue;
    if (isPlaceholder(value)) plain.push(`${name} hidden by Retell`);
    else if (f.type === "name") withs.push(`with ${String(value).trim()}`);
    else plain.push(formatValue(f.type, value, zone.tz, zone.policyTz));
  }
  const text = [plain.join(", "), ...withs].filter((s) => s !== "").join(" ");
  return text === "" ? "nothing" : text;
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

/** An item from an earlier lookup that carries the change's id, with the lookup it came from. */
interface Candidate {
  use: ToolUse;
  item: unknown;
}

/**
 * The items the change could mean: every item with the change's id in the earlier successful lookups, oldest
 * lookup first and in list order within one. Only a lookup whose ok is true counts: a failed one offers nothing,
 * and so does one whose success is unknown (after resolveOk a lookup with a readable items list is already true,
 * so a null one has no list to read). An id matches exactly first: when any item matches exactly, only exact
 * matches are candidates; only when none does, items that match ignoring letter case are. Two or more candidates
 * are not ranked here: committedDetails compares them and picks none when they disagree.
 */
function candidateItems(ev: Evidence, policy: Policy, change: ToolUse, changeId: unknown): Candidate[] {
  const wanted = idKey(changeId);
  if (wanted === null) return [];
  const earlier = toolCalls(ev, policy, "lookup")
    .filter((u) => u.resultSeq !== null && u.resultSeq < change.callSeq && u.ok === true)
    .sort((a, b) => a.resultSeq! - b.resultSeq!);
  for (const exact of [true, false]) {
    const found = earlier.flatMap((use): Candidate[] => {
      const idPath = toolPolicy(policy, use.tool)?.id;
      if (idPath === undefined) return [];
      return itemsOf(policy, use)
        .filter((it) => {
          const key = idKey(readPath(idPath, { item: it }));
          return key !== null && (exact ? key.exact === wanted.exact : key.folded === wanted.folded);
        })
        .map((item) => ({ use, item }));
    });
    if (found.length > 0) return found;
  }
  return [];
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
