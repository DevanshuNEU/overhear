// The eval case: one raw call record plus what the engine should say about it. It is the one format for three
// writers: the hand-labeled cases in eval/engine/cases/ today, the product's "pin this call as a regression test"
// later (a pinned call is a case the user labeled), and an M2 converter for outside data such as tau-bench.
// The runner (run.ts) reads only this shape, so a new writer needs no new runner.
//
// The schema is strict on purpose: a typo in a key, an unknown contract or a verdict that contradicts its own
// contract results fails loudly when the case is read, never quietly as a wrong measurement.
import { z } from "zod";
import { CONTRACT_IDS, EXPERIENCE_CHECKS, RESULTS, VERDICTS } from "@/report/schema";
import { compactJson } from "./json";

export const CASE_SCHEMA_VERSION = 1;

/**
 * Where a case came from. real: a call that happened, scrubbed. mutation: a programmatic edit of another case,
 * named in derivedFrom. external: converted from data someone else built, such as a public benchmark.
 */
export const CASE_SOURCES = ["real", "mutation", "external"] as const;

/** Platforms whose raw records the engine reads. LiveKit joins in M2. */
export const CASE_PLATFORMS = ["retell"] as const;

/** Lowercase words and digits joined by hyphens, such as "sample-failed" or "mut-drop-success-001". */
const CASE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** True for a time zone Intl knows by name. Mirrors the report schema's check, with a named locale (purity). */
function isTimeZone(zone: string): boolean {
  if (zone === "" || /^[+-]/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const Contract = z.enum(CONTRACT_IDS);

/** What a person kept for a call experience check: the engine must report a problem, or must stay clean. */
export const EXPERIENCE_EXPECTS = ["problem", "clean"] as const;

export type ExperienceExpect = (typeof EXPERIENCE_EXPECTS)[number];

/** The longest note a pinned call carries. */
export const PIN_NOTE_MAX = 280;

/** Platform call and agent ids: letters, digits, hyphens and underscores. Copied from the pull side to keep the engine pure. */
const PLATFORM_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** A pin file is untrusted text that is printed to terminals and logs, so its free-form fields get narrow shapes. */
const AGENT_VERSION = /^[0-9A-Za-z._-]{1,64}$/;
const PINNED_WITH = /^[0-9A-Za-z.+-]{1,64}$/;

/** C0 and C1 controls (newlines and escape sequences included), DEL, and the Unicode line and paragraph separators. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u{2028}\u{2029}]/u;

/**
 * Where a pinned call came from: the call and agent it was pinned from, the Overhear version that read it, and
 * for a fix pin (a passing call of the same scenario) the id of the pinned case it fixes.
 */
const PinSchema = z.strictObject({
  callId: z.string().regex(PLATFORM_ID, "must be letters, digits, hyphens and underscores"),
  agentId: z.string().regex(PLATFORM_ID, "must be letters, digits, hyphens and underscores"),
  agentVersion: z.string().regex(AGENT_VERSION, "must be letters, digits, dots, hyphens and underscores, at most 64").nullable(),
  pinnedWith: z.string().regex(PINNED_WITH, "must be a version: letters, digits, dots, plus and hyphen, at most 64"),
  fixes: z.string().regex(CASE_ID).optional(),
});

const ExpectSchema = z
  .strictObject({
    verdict: z.enum(VERDICTS),
    // Only what a person checked. A contract left out is not scored for agreement.
    contracts: z.partialRecord(Contract, z.enum(RESULTS)).optional(),
    // Turns and tool items the contract's findings must cite (said, did or asked), by evidence seq.
    mustCite: z.array(z.strictObject({ contract: Contract, seqs: z.array(z.number().int().positive()).min(1) })).optional(),
    // Only the call experience checks a person kept. A check left out is not scored.
    experience: z.partialRecord(z.enum(EXPERIENCE_CHECKS), z.enum(EXPERIENCE_EXPECTS)).optional(),
  })
  .superRefine((e, ctx) => {
    const results = Object.entries(e.contracts ?? {});
    // Spec 6.6: any violated contract makes the call failed; any unverified one keeps it from passed.
    for (const [contract, result] of results) {
      if (result === "violated" && e.verdict !== "failed") {
        ctx.addIssue({ code: "custom", path: ["contracts", contract], message: `${contract} is violated, so the verdict must be failed` });
      }
      if (result === "unverified" && (e.verdict === "passed" || e.verdict === "nothing_done")) {
        ctx.addIssue({ code: "custom", path: ["contracts", contract], message: `${contract} is unverified, so the verdict cannot be ${e.verdict}` });
      }
    }
    (e.mustCite ?? []).forEach((m, i) => {
      const result = e.contracts?.[m.contract];
      if (result === "not_applicable" || result === "not_run") {
        ctx.addIssue({ code: "custom", path: ["mustCite", i], message: `${m.contract} is expected ${result}, so it has no findings to cite` });
      }
    });
  });

export const EvalCaseSchema = z
  .strictObject({
    schemaVersion: z.literal(CASE_SCHEMA_VERSION),
    id: z.string().regex(CASE_ID, "must be lowercase words and digits joined by hyphens"),
    source: z.enum(CASE_SOURCES),
    // True only for data we did not build (spec 9). Independent and constructed cases are never pooled.
    independent: z.boolean(),
    platform: z.enum(CASE_PLATFORMS),
    // A locked case's expected verdict is a promise: CI fails when the engine's verdict differs from it, so the
    // verdict can only change in a pull request that edits this file and says why in label.note.
    locked: z.boolean(),
    // Who decided the truth, and when (a date, or a date and time).
    label: z.strictObject({
      by: z.string().min(1),
      at: z.union([z.iso.date(), z.iso.datetime({ offset: true })]),
      note: z.string().min(1).optional(),
    }),
    // For a mutation: the id of the case it was made from.
    derivedFrom: z.string().regex(CASE_ID).optional(),
    // The time zone the engine reads spoken times in when the agent's policy names none. Default UTC.
    tz: z.string().refine(isTimeZone, "must be an IANA time zone, such as UTC or America/New_York").optional(),
    // Present only on a call a person pinned as a regression test (see docs/evals.md).
    pin: PinSchema.optional(),
    expect: ExpectSchema,
    // The raw platform record, scrubbed, exactly as the platform's API returns it (Retell: GET /v2/get-call).
    record: z.record(z.string(), z.unknown()),
  })
  .superRefine((c, ctx) => {
    if (c.source === "mutation" && c.derivedFrom === undefined) {
      ctx.addIssue({ code: "custom", path: ["derivedFrom"], message: "a mutation must name its parent case" });
    }
    if (c.source !== "mutation" && c.derivedFrom !== undefined) {
      ctx.addIssue({ code: "custom", path: ["derivedFrom"], message: "only a mutation has a derivedFrom" });
    }
    if (c.source === "mutation" && c.independent) {
      ctx.addIssue({ code: "custom", path: ["independent"], message: "a mutation is data we built, so it is never independent" });
    }
    if (c.pin !== undefined) {
      const need = (ok: boolean, path: string, message: string): void => {
        if (!ok) ctx.addIssue({ code: "custom", path: [path], message });
      };
      need(c.tz !== undefined, "tz", "a pinned call needs the time zone it was pinned in");
      need(c.source === "real", "source", "a pinned call is a real call, so its source must be real");
      need(c.locked, "locked", "a pinned call must be locked, or a changed reading would not fail");
      need(!c.independent, "independent", "a pinned call is never independent");
      const note = c.label.note;
      if (note !== undefined && (note.length > PIN_NOTE_MAX || CONTROL_CHARS.test(note))) {
        ctx.addIssue({ code: "custom", path: ["label", "note"], message: `a pinned call's note is one line of plain text, at most ${PIN_NOTE_MAX} characters` });
      }
      if (c.label.by !== "you") {
        ctx.addIssue({ code: "custom", path: ["label", "by"], message: "a pinned call is labeled by you" });
      }
      need(c.platform === "retell", "platform", "a pinned call is a Retell call");
      if (c.pin.fixes === c.id) {
        ctx.addIssue({ code: "custom", path: ["pin", "fixes"], message: "a fix pin cannot fix itself" });
      }
      // The pin's claim about where the call came from must match the record it carries.
      if (c.record.call_id !== c.pin.callId) {
        ctx.addIssue({ code: "custom", path: ["record", "call_id"], message: "the record's call_id must equal pin.callId" });
      }
      if (c.record.agent_id !== undefined && c.record.agent_id !== c.pin.agentId) {
        ctx.addIssue({ code: "custom", path: ["record", "agent_id"], message: "the record's agent_id must equal pin.agentId" });
      }
    }
  });

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type CaseSource = (typeof CASE_SOURCES)[number];

/** The case, typed, when it validates; otherwise throws with where it came from and every problem on its own line. */
export function parseCase(raw: unknown, where = "case"): EvalCase {
  const parsed = EvalCaseSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`);
  throw new Error(`${where} is not a valid eval case:\n${issues.join("\n")}`);
}

/** The order a case file's top-level keys are written in: who and what first, the long record last. */
const KEY_ORDER: readonly string[] = ["schemaVersion", "id", "source", "independent", "platform", "locked", "label", "pin", "derivedFrom", "tz", "expect"];
const order = (key: string): number => (key === "record" ? KEY_ORDER.length + 1 : KEY_ORDER.includes(key) ? KEY_ORDER.indexOf(key) : KEY_ORDER.length);

/**
 * A case as the text of its file. Every writer uses this, so the files read the same and a diff shows the line
 * that changed: one transcript item, one tool call, one label field, rather than one word per line.
 */
export function formatCase(c: EvalCase): string {
  // A key added to the schema but not to KEY_ORDER still gets written, just before the record.
  const keys = Object.keys(c).sort((a, b) => order(a) - order(b));
  return compactJson(Object.fromEntries(keys.map((k) => [k, c[k as keyof EvalCase]])));
}

/** Problems that span cases: duplicate ids, and mutations whose parent is not among them. Empty when none. */
export function checkCaseSet(cases: readonly EvalCase[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) problems.push(`two cases have the id ${c.id}`);
    ids.add(c.id);
  }
  for (const c of cases) {
    if (c.derivedFrom !== undefined && !ids.has(c.derivedFrom)) problems.push(`${c.id} is derived from ${c.derivedFrom}, which is not a case`);
  }
  return problems;
}
