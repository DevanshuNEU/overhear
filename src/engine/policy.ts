// The policy (spec 6.5): which tool does what, where success and committed details live, and which contracts run.
//
// Every call gets one. The demo agent gets its preset, presets/northwind-clinic.json. Any other agent gets a policy
// inferred from its tool names and the shapes of its tool calls and results. Inference uses the scheduling pack and
// leaves the time zone unset, so the caller's zone applies (6.5). The preset names UTC: the demo stores slots in UTC.
import { CONTRACT_IDS, PolicySchema, type ContractId, type Evidence, type Policy } from "@/report/schema";
import northwind from "./presets/northwind-clinic.json";

export type Pack = Policy["packs"][number];
export type ToolPolicy = Policy["tools"][string];
type FieldPolicy = Policy["fields"][string];
type Rec = Record<string, unknown>;

const SCHEDULING: readonly ContractId[] = ["promise_backed", "spoken_matches_committed", "transfer_kept", "committed_matches_request"];

/** The contracts each pack runs. healthcare includes scheduling and adds verified_before_change. */
export const PACKS: Record<Pack, readonly ContractId[]> = {
  scheduling: SCHEDULING,
  healthcare: [...SCHEDULING, "verified_before_change"],
};

/** The contracts a set of packs runs, once each, in spec order. */
export function contractsFor(packs: readonly Pack[]): ContractId[] {
  const wanted = new Set(packs.flatMap((p) => PACKS[p]));
  return CONTRACT_IDS.filter((c) => wanted.has(c));
}

/** M1 runs the scheduling pack. */
export const M1_CONTRACTS: readonly ContractId[] = contractsFor(["scheduling"]);

const NORTHWIND: Policy = PolicySchema.parse(northwind);

/** A tool's entry in the policy, by exact name; undefined when the policy does not name it. */
export function toolPolicy(policy: Policy, name: string): ToolPolicy | undefined {
  return Object.hasOwn(policy.tools, name) ? policy.tools[name] : undefined;
}

/**
 * The policy for one call, and where it came from. The preset applies only when the call looks like the demo agent
 * by more than its tool names, which are common: it has at least one tool call, every tool it calls is in the
 * preset, every lookup result that did not fail has the demo's shape (result.slots, each with a startsAt), and at
 * least one result shows the demo: such a lookup result, or another preset tool's result in the demo's shape, never
 * a tool name alone. A lookup result
 * the platform says failed says nothing about whose agent this is, so it is neutral (see isDemoAgent).
 *
 * Later work: key the preset by Retell agent id instead of by shape. The evidence carries no agent id today, so the
 * shape is the best signal M1 has.
 */
export function policyFor(ev: Evidence): { policy: Policy; source: "preset" | "inferred" } {
  if (isDemoAgent(ev)) return { policy: structuredClone(NORTHWIND), source: "preset" };
  return { policy: inferPolicy(ev), source: "inferred" };
}

/**
 * A lookup result the platform says failed is neutral: it says nothing about whose agent this is, so it neither
 * counts for the demo nor against it. The call still needs one positive sign, and a sign is what a result says,
 * never a tool's name (names are too common): a lookup answered in the demo's slot shape, or another preset tool's
 * result in the shape the demo gives it. A call whose only evidence is a failed lookup, or a call with no result in
 * the demo's shape, stays inferred.
 */
function isDemoAgent(ev: Evidence): boolean {
  const calls = ev.items.flatMap((it) => (it.kind === "tool_call" ? [it] : []));
  if (calls.length === 0 || !calls.every((c) => toolPolicy(NORTHWIND, c.name))) return false;
  const nameOf = new Map(calls.map((c) => [c.id, c.name]));
  const answered = ev.items.flatMap((it) => (it.kind === "tool_result" && it.platformOk !== false ? [{ tool: nameOf.get(it.id), payload: it.payload }] : []));
  const lookups = answered.filter((r) => r.tool !== undefined && toolPolicy(NORTHWIND, r.tool)?.role === "lookup");
  if (!lookups.every((r) => hasDemoSlots(r.payload))) return false;
  return lookups.length > 0 || answered.some((r) => r.tool !== undefined && hasDemoResult(r.tool, r.payload));
}

/** What the demo's other tools answer: verify_patient { verified, patientId } and each change { ok }. */
function hasDemoResult(tool: string, payload: unknown): boolean {
  if (!isRec(payload)) return false;
  const role = toolPolicy(NORTHWIND, tool)?.role;
  if (role === "verify") return typeof payload.verified === "boolean" && (payload.verified !== true || typeof payload.patientId === "string");
  if (role === "change") return typeof payload.ok === "boolean";
  return false;
}

/** The demo's availability answer: { slots: [{ startsAt: "..." }, ...] }. */
function hasDemoSlots(payload: unknown): boolean {
  return isRec(payload) && Array.isArray(payload.slots) && payload.slots.every((s) => isRec(s) && typeof s.startsAt === "string");
}

// ---------- Roles from tool names ----------

/** Role rules, in order; the first rule with a word in the tool's name wins (old plan Task 5). */
const ROLE_RULES: { words: string[]; role: Pick<ToolPolicy, "role" | "kind"> }[] = [
  { words: ["verify", "authenticate", "identify"], role: { role: "verify" } },
  { words: ["transfer"], role: { role: "transfer" } },
  { words: ["cancel"], role: { role: "change", kind: "cancel" } },
  { words: ["reschedule", "move"], role: { role: "change", kind: "reschedule" } },
  { words: ["book", "schedule", "create", "reserve"], role: { role: "change", kind: "book" } },
  { words: ["update", "modify", "change", "exchange", "return"], role: { role: "change", kind: "update" } },
  { words: ["check", "get", "find", "list", "search", "lookup", "availability"], role: { role: "lookup" } },
];

/** The words of a tool name: split at underscores, dashes, spaces and camelCase humps, lower-cased. */
function nameWords(name: string): Set<string> {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return new Set(spaced.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

/**
 * The role a tool name suggests, or null for none. Rules match whole words, not substrings, so "get_bookings" is a
 * lookup rather than a booking and "remove_item" is not a reschedule.
 */
export function roleFor(name: string): Pick<ToolPolicy, "role" | "kind"> | null {
  const words = nameWords(name);
  const rule = ROLE_RULES.find((r) => r.words.some((w) => words.has(w)));
  return rule ? { ...rule.role } : null;
}

// ---------- Inference ----------

/** One tool call with the payloads of its results. */
type Use = { name: string; args: Rec; payloads: unknown[] };

/**
 * A policy for an agent we know nothing about, from its tool names and what its tools sent and returned (6.5).
 * Tools whose names match no role are left out. A lookup's items are the first list of objects in its result,
 * matched by id, slotId or slot_id; a change's id is the argument whose value equals one of those ids. Date, time
 * and provider fields come from the items, or from a change's arguments when no lookup listed any. Inferred date and
 * time fields are required. A boolean ok or success in results becomes the success path.
 */
export function inferPolicy(ev: Evidence): Policy {
  const uses = toolUses(ev);
  const names = [...new Set(uses.map((u) => u.name))].filter((n) => roleFor(n) !== null);
  const usesOf = (name: string) => uses.filter((u) => u.name === name);

  const lookups = new Map<string, ItemList>();
  for (const name of names) {
    if (roleFor(name)?.role !== "lookup") continue;
    const found = usesOf(name)
      .flatMap((u) => u.payloads)
      .map((p) => itemList(p))
      .find((l) => l !== null);
    if (found) lookups.set(name, found);
  }
  const itemIds = new Set([...lookups.values()].flatMap((l) => l.ids));

  const successKeys = new Map<string, string>();
  for (const name of names) {
    const key = successKey(usesOf(name).flatMap((u) => u.payloads));
    if (key) successKeys.set(name, key);
  }
  const oneKey = new Set(successKeys.values()).size === 1 ? [...successKeys.values()][0] : undefined;

  const tools = Object.fromEntries(
    names.map((name): [string, ToolPolicy] => {
      const tp: ToolPolicy = { ...roleFor(name)! };
      const list = lookups.get(name);
      if (list) {
        tp.items = list.path;
        if (list.idKey) tp.id = `item.${list.idKey}`;
      }
      if (tp.role === "change") {
        const idArg = usesOf(name)
          .flatMap((u) => Object.entries(u.args))
          .find(([k, v]) => isKey(k) && (typeof v === "string" || typeof v === "number") && itemIds.has(String(v).toLowerCase()));
        if (idArg) tp.id = `args.${idArg[0]}`;
      }
      const key = successKeys.get(name);
      if (key && !oneKey) tp.success = `result.${key}`;
      return [name, tp];
    }),
  );

  const fromItems = [...lookups.values()].map((l) => fieldsFrom(l.items[0], "item")).find((f) => Object.keys(f).length > 0);
  const fromArgs = uses
    .filter((u) => names.includes(u.name) && roleFor(u.name)?.role === "change")
    .map((u) => fieldsFrom(u.args, "args"))
    .find((f) => Object.keys(f).length > 0);

  const policy: Policy = { packs: ["scheduling"], tools, fields: fromItems ?? fromArgs ?? {} };
  if (oneKey) policy.success = `result.${oneKey}`;
  return policy;
}

/** Every tool call in order, with the payloads of the results that answer it. */
function toolUses(ev: Evidence): Use[] {
  const uses = new Map<string, Use>();
  for (const it of ev.items) {
    if (it.kind === "tool_call" && !uses.has(it.id)) uses.set(it.id, { name: it.name, args: it.args, payloads: [] });
    if (it.kind === "tool_result") uses.get(it.id)?.payloads.push(it.payload);
  }
  return [...uses.values()];
}

type ItemList = { path: string; items: Rec[]; idKey: string | null; ids: string[] };

const ID_KEYS = ["id", "slotId", "slot_id"];

/** The first list of objects in a result, depth first in key order, a few levels down at most. */
function itemList(payload: unknown): ItemList | null {
  const found = firstListOfObjects(payload, "result", 0);
  if (!found) return null;
  const idKey = ID_KEYS.find((k) => isIdValue(found.items[0][k])) ?? null;
  const ids = idKey ? found.items.flatMap((item) => (isIdValue(item[idKey]) ? [String(item[idKey]).toLowerCase()] : [])) : [];
  return { ...found, idKey, ids };
}

function firstListOfObjects(value: unknown, path: string, depth: number): { path: string; items: Rec[] } | null {
  if (Array.isArray(value)) return value.length > 0 && value.every(isRec) ? { path, items: value } : null;
  if (!isRec(value) || depth >= 3) return null;
  for (const [key, child] of Object.entries(value)) {
    if (!isKey(key)) continue;
    const found = firstListOfObjects(child, `${path}.${key}`, depth + 1);
    if (found) return found;
  }
  return null;
}

/** The success key results carry as a boolean: ok first, then success. */
function successKey(payloads: unknown[]): string | null {
  for (const key of ["ok", "success"]) {
    if (payloads.some((p) => isRec(p) && typeof p[key] === "boolean")) return key;
  }
  return null;
}

const DATE_TIME_KEYS = ["date", "time", "start_time", "startsAt", "starts_at", "datetime"];
const PROVIDER_KEYS = ["provider", "providerName", "doctor"];

/** Date, time and provider fields read from one object's keys, judged by the shape of each value. */
function fieldsFrom(rec: Rec, root: "item" | "args"): Record<string, FieldPolicy> {
  let date: FieldPolicy | undefined;
  let time: FieldPolicy | undefined;
  let provider: FieldPolicy | undefined;
  for (const key of DATE_TIME_KEYS) {
    if (!Object.hasOwn(rec, key)) continue;
    const shape = timeShape(rec[key]);
    const path = `${root}.${key}`;
    if ((shape === "datetime" || shape === "date") && !date) date = { path, type: "date", required: true };
    if ((shape === "datetime" || shape === "time") && !time) time = { path, type: "time", required: true };
  }
  const providerKey = PROVIDER_KEYS.find((k) => Object.hasOwn(rec, k) && typeof rec[k] === "string" && (rec[k] as string).trim() !== "");
  if (providerKey) provider = { path: `${root}.${providerKey}`, type: "name" };
  return Object.fromEntries(Object.entries({ date, time, provider }).filter((e): e is [string, FieldPolicy] => e[1] !== undefined));
}

/** Whether a value reads as a date and time ("2026-11-06T14:00:00Z"), a date ("2026-11-06") or a time ("2:00 p.m."). */
function timeShape(v: unknown): "datetime" | "date" | "time" | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(s)) return "datetime";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "date";
  if (/^\d{1,2}:\d{2}(:\d{2})?(\s*[ap]\.?\s?m\.?)?$/i.test(s) || /^\d{1,2}\s*[ap]\.?\s?m\.?$/i.test(s)) return "time";
  return null;
}

const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isIdValue = (v: unknown): v is string | number => (typeof v === "string" && v !== "") || (typeof v === "number" && Number.isFinite(v));
/** A key a policy path can name: not empty, no dot. */
const isKey = (k: string) => k !== "" && !k.includes(".");
