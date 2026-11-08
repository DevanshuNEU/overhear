// The eval runner: every case through an engine, each compared with what its label expects. Pure, like the rest
// of the engine: it takes cases and an Analyze function and returns plain results. Reading the case files and
// writing the report happen in scripts/run-engine-evals.ts.
//
// A case passes only when the engine returned a valid report and the verdict, every labeled contract, every kept
// call experience check and every required citation match. An error, a no_content outcome or a report that does not validate never passes and
// never counts as a verdict.
import {
  CONTRACT_IDS,
  EXPERIENCE_CHECKS,
  CallReportSchema,
  type CallReport,
  type ContractId,
  type ExperienceCheckId,
  type Result,
  type Verdict,
} from "@/report/schema";
import type { Analyze, Outcome } from "../types";
import type { CaseSource, EvalCase, ExperienceExpect } from "./case";

/** The time zone a case is read in when it names none. */
export const DEFAULT_TZ = "UTC";

/** The verdict, or why there is none. */
export type ActualVerdict = Verdict | "no_content" | "error";

/** A contract's result, or why there is none: the report left the contract out, or there was no report. */
export type ActualResult = Result | "missing" | "no_report";

export interface ContractCheck {
  contract: ContractId;
  expected: Result;
  actual: ActualResult;
  agree: boolean;
}

/** What the engine said about a kept experience check: a problem, clean, or why it said neither. */
export type ActualExperience = ExperienceExpect | "not_run" | "no_report";

export interface ExperienceCheck {
  check: ExperienceCheckId;
  expected: ExperienceExpect;
  /** not_run: the report's experience.ran does not list the check, so its silence proves nothing. */
  actual: ActualExperience;
  agree: boolean;
}

export interface CiteCheck {
  contract: ContractId;
  seqs: number[];
  /** The required seqs no finding of the contract cites. */
  missing: number[];
  ok: boolean;
}

export interface CaseResult {
  id: string;
  source: CaseSource;
  independent: boolean;
  locked: boolean;
  outcome: Outcome["kind"];
  /** The error's message, or the no_content reason; null for a report. */
  message: string | null;
  expected: Verdict;
  actual: ActualVerdict;
  verdictMatch: boolean;
  /** One check per labeled contract, in the schema's contract order. */
  contracts: ContractCheck[];
  /** Every contract result the report returned, labeled or not. Empty with no report. */
  results: Partial<Record<ContractId, Result>>;
  mustCite: CiteCheck[];
  /** One check per kept experience check, in the schema's order. Empty when the case keeps none. */
  experience: ExperienceCheck[];
  pass: boolean;
}

/**
 * The engine's outcome for a case, with anything that is not a valid report (a throw, or a report the schema
 * rejects) turned into an error outcome carrying the record's call id.
 */
export function outcomeOf(c: EvalCase, analyze: Analyze): Outcome {
  const callId = typeof c.record.call_id === "string" ? c.record.call_id : null;
  let out: Outcome;
  try {
    out = analyze(c.record, { tz: c.tz ?? DEFAULT_TZ });
  } catch (err) {
    return { kind: "error", callId, message: `the engine threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (out.kind !== "report") return out;
  const parsed = CallReportSchema.safeParse(out.report);
  if (parsed.success) return { kind: "report", report: parsed.data };
  const first = parsed.error.issues[0];
  return { kind: "error", callId, message: `the engine returned a report that does not validate: ${first.path.join(".")}: ${first.message}` };
}

/** Every seq the contract's findings cite: said, did and asked. */
function citedBy(report: CallReport, contract: ContractId): Set<number> {
  const result = report.results.find((r) => r.contract === contract);
  return new Set((result?.findings ?? []).flatMap((f) => [...f.said, ...f.did, ...f.asked]));
}

/** One case through the engine, compared with its label. */
export function runCase(c: EvalCase, analyze: Analyze): CaseResult {
  const out = outcomeOf(c, analyze);
  const report = out.kind === "report" ? out.report : null;

  const results: Partial<Record<ContractId, Result>> = {};
  for (const r of report?.results ?? []) results[r.contract] = r.result;

  const labeled = c.expect.contracts ?? {};
  const contracts: ContractCheck[] = CONTRACT_IDS.flatMap((contract) => {
    const expected = labeled[contract];
    if (expected === undefined) return [];
    const actual: ActualResult = report === null ? "no_report" : (results[contract] ?? "missing");
    return [{ contract, expected, actual, agree: actual === expected }];
  });

  const kept = c.expect.experience ?? {};
  const experience: ExperienceCheck[] = EXPERIENCE_CHECKS.flatMap((check) => {
    const expected = kept[check];
    if (expected === undefined) return [];
    let actual: ActualExperience;
    if (report === null) actual = "no_report";
    else if (!report.experience.ran.includes(check)) actual = "not_run";
    else actual = report.experience.problems.some((p) => p.check === check) ? "problem" : "clean";
    return [{ check, expected, actual, agree: actual === expected }];
  });

  const mustCite: CiteCheck[] = (c.expect.mustCite ?? []).map(({ contract, seqs }) => {
    const cited = report === null ? new Set<number>() : citedBy(report, contract);
    const missing = seqs.filter((s) => !cited.has(s));
    return { contract, seqs: [...seqs], missing, ok: missing.length === 0 };
  });

  const actual: ActualVerdict = out.kind === "report" ? out.report.verdict : out.kind;
  const verdictMatch = actual === c.expect.verdict;

  return {
    id: c.id,
    source: c.source,
    independent: c.independent,
    locked: c.locked,
    outcome: out.kind,
    message: out.kind === "error" ? out.message : out.kind === "no_content" ? out.reason : null,
    expected: c.expect.verdict,
    actual,
    verdictMatch,
    contracts,
    results,
    mustCite,
    experience,
    pass: report !== null && verdictMatch && contracts.every((k) => k.agree) && experience.every((k) => k.agree) && mustCite.every((m) => m.ok),
  };
}

/**
 * Why a locked case broke its lock, or null when it holds. The lock is on the verdict only: a missed contract
 * or citation is measured in the report, but only a changed verdict fails CI. An unlocked case never breaks.
 */
export function brokenLock(r: CaseResult): string | null {
  if (!r.locked || r.verdictMatch) return null;
  const said = r.message === null ? r.actual : `${r.actual} (${r.message})`;
  return `${r.id} is locked to ${r.expected}, and the engine said ${said}. If ${r.actual} is right, change expect.verdict in eval/engine/cases/${r.id}.json and say why in label.note.`;
}

/** Every case through the engine, in the order given. */
export function runEngineEval(cases: readonly EvalCase[], analyze: Analyze): CaseResult[] {
  return cases.map((c) => runCase(c, analyze));
}
