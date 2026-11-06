// What the eval runner's results add up to. Pure. Every rate carries its k and n, and a rate with n = 0 is "no
// data" (value null), never 0% or 100%. Independent and constructed data are measured in separate groups and
// never pooled into one figure (spec 3 and 9); groupMetrics refuses a mix.
//
// A case the engine returned no report for (an error or no_content) is never in the engine's favour: it counts
// as wrong for verdict accuracy and agreement, and as a miss for recall. It is left out of precision (the engine
// predicted nothing) and of the false-failed rate (the engine raised no false alarm, it gave no answer at all).
import { CONTRACT_IDS, RESULTS, VERDICTS, type ContractId, type Result, type Verdict } from "@/report/schema";
import type { Outcome } from "../types";
import { CASE_SOURCES, type CaseSource } from "./case";
import type { ActualResult, ActualVerdict, CaseResult } from "./run";

/** k of n, the share, and its Wilson 95% interval. value and ci are null when n = 0. */
export interface Rate {
  k: number;
  n: number;
  value: number | null;
  ci: [number, number] | null;
}

export interface OverallMetrics {
  /** Expected verdict by actual verdict (or why there was none). */
  confusion: Record<Verdict, Record<ActualVerdict, number>>;
  verdictAccuracy: Rate;
  /** Of the calls the engine called failed, how many were labeled failed. */
  failedPrecision: Rate;
  /** Of the calls labeled failed, how many the engine called failed. */
  failedRecall: Rate;
  /** Of the calls labeled passed that the engine gave a verdict on, how many it called failed. The costly error. */
  falseFailedRate: Rate;
}

export interface ContractMetrics {
  /** Cases a person labeled for this contract. */
  n: number;
  /** Expected result by actual result, over labeled cases. */
  confusion: Record<Result, Record<ActualResult, number>>;
  agreement: Rate;
  violatedPrecision: Rate;
  violatedRecall: Rate;
  /** Of the calls labeled passed that the engine reported on, how many had this contract violated. */
  falseViolatedRate: Rate;
  /** Of the reports where this contract applied (violated, passed or unverified), how many were unverified. */
  unverifiedRate: Rate;
}

export interface GroupMetrics {
  n: number;
  sources: Record<CaseSource, number>;
  outcomes: Record<Outcome["kind"], number>;
  /** Cases that passed every check: verdict, labeled contracts and citations. */
  passing: Rate;
  overall: OverallMetrics;
  contracts: Record<ContractId, ContractMetrics>;
}

export interface EngineMetrics {
  independent: GroupMetrics;
  constructed: GroupMetrics;
}

const Z95 = 1.959964;
const OUTCOME_KINDS = ["report", "no_content", "error"] as const;
const ACTUAL_VERDICTS: readonly ActualVerdict[] = [...VERDICTS, "no_content", "error"];
const ACTUAL_RESULTS: readonly ActualResult[] = [...RESULTS, "missing", "no_report"];
const APPLIED: readonly Result[] = ["violated", "passed", "unverified"];

const round4 = (x: number): number => Math.round(x * 10000) / 10000;

/** Wilson score interval for k successes in n trials. n must be above 0: with no data there is no interval. */
export function wilson(k: number, n: number, z = Z95): [number, number] {
  if (!(n > 0)) throw new RangeError(`wilson needs n above 0, got n = ${n}`);
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  // At k = 0 and k = n the bound is exactly 0 or 1; floating point lands a hair inside it.
  return [k === 0 ? 0 : Math.max(0, centre - margin), k === n ? 1 : Math.min(1, centre + margin)];
}

/** k of n as a Rate, rounded to four places so the committed report diffs cleanly. */
export function rate(k: number, n: number): Rate {
  if (n === 0) return { k, n, value: null, ci: null };
  const [lo, hi] = wilson(k, n);
  return { k, n, value: round4(k / n), ci: [round4(lo), round4(hi)] };
}

/** k of n over the items that are in the denominator. */
function rateOf<T>(items: readonly T[], inDenominator: (t: T) => boolean, isHit: (t: T) => boolean): Rate {
  const pool = items.filter(inDenominator);
  return rate(pool.filter(isHit).length, pool.length);
}

/** A table with every row and column present, all zero. */
function table<R extends string, C extends string>(rows: readonly R[], cols: readonly C[]): Record<R, Record<C, number>> {
  return Object.fromEntries(rows.map((r) => [r, Object.fromEntries(cols.map((c) => [c, 0]))])) as Record<R, Record<C, number>>;
}

function countBy<K extends string>(keys: readonly K[], values: readonly K[]): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const v of values) out[v] += 1;
  return out;
}

const hasReport = (r: CaseResult): boolean => r.outcome === "report";
const labeledNormal = (r: CaseResult): boolean => r.expected === "passed" && hasReport(r);

function overallMetrics(results: readonly CaseResult[]): OverallMetrics {
  const confusion = table(VERDICTS, ACTUAL_VERDICTS);
  for (const r of results) confusion[r.expected][r.actual] += 1;
  return {
    confusion,
    verdictAccuracy: rateOf(results, () => true, (r) => r.verdictMatch),
    failedPrecision: rateOf(results, (r) => r.actual === "failed", (r) => r.expected === "failed"),
    failedRecall: rateOf(results, (r) => r.expected === "failed", (r) => r.actual === "failed"),
    falseFailedRate: rateOf(results, labeledNormal, (r) => r.actual === "failed"),
  };
}

function contractMetrics(results: readonly CaseResult[], contract: ContractId): ContractMetrics {
  const checks = results.flatMap((r) => r.contracts.filter((k) => k.contract === contract));
  const confusion = table(RESULTS, ACTUAL_RESULTS);
  for (const k of checks) confusion[k.expected][k.actual] += 1;
  const got = (r: CaseResult): Result | undefined => r.results[contract];
  return {
    n: checks.length,
    confusion,
    agreement: rateOf(checks, () => true, (k) => k.agree),
    violatedPrecision: rateOf(checks, (k) => k.actual === "violated", (k) => k.expected === "violated"),
    violatedRecall: rateOf(checks, (k) => k.expected === "violated", (k) => k.actual === "violated"),
    falseViolatedRate: rateOf(results, labeledNormal, (r) => got(r) === "violated"),
    unverifiedRate: rateOf(results, (r) => APPLIED.includes(got(r) as Result), (r) => got(r) === "unverified"),
  };
}

/** The metrics for one group of results, all independent or all constructed. Throws on a mix. */
export function groupMetrics(results: readonly CaseResult[]): GroupMetrics {
  if (new Set(results.map((r) => r.independent)).size > 1) {
    throw new Error("independent and constructed data are never pooled: measure each group on its own");
  }
  return {
    n: results.length,
    sources: countBy(CASE_SOURCES, results.map((r) => r.source)),
    outcomes: countBy(OUTCOME_KINDS, results.map((r) => r.outcome)),
    passing: rateOf(results, () => true, (r) => r.pass),
    overall: overallMetrics(results),
    contracts: Object.fromEntries(CONTRACT_IDS.map((c) => [c, contractMetrics(results, c)])) as Record<ContractId, ContractMetrics>,
  };
}

/** The metrics for independent and constructed data, side by side and never pooled. */
export function engineMetrics(results: readonly CaseResult[]): EngineMetrics {
  return {
    independent: groupMetrics(results.filter((r) => r.independent)),
    constructed: groupMetrics(results.filter((r) => !r.independent)),
  };
}
