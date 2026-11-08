// Test-only: pins built from the scrubbed samples, so the tests of the check command have real records and a verdict the
// engine really gives. Nothing here is imported by product code.
import { analyzeRetellCall } from "@/engine/analyze";
import { parseCase, type EvalCase, type ExperienceExpect } from "@/engine/eval/case";
import { toRetell } from "@/engine/testing/retell";
import type { ContractId, ExperienceCheckId, Result, Verdict } from "@/report/schema";
import { failedSample, passedSample } from "@/report/samples";
import { pinIdFor } from "./pin-id";

export const TZ = "America/New_York";

/** A sample's record, as Retell returns it, under another call id. */
export function recordOf(sample: typeof failedSample, callId: string): Record<string, unknown> {
  return { ...(toRetell(sample.evidence) as Record<string, unknown>), call_id: callId };
}

/**
 * The same record with `marker` added to every string in it, keys aside, except what the check prints on purpose (the call
 * id and agent id) and the words the engine reads structure from (role, status and type values).
 */
export function marked(value: unknown, marker: string, key = ""): unknown {
  if (typeof value === "string") return /^(call_id|agent_id|role|call_status|call_type)$/.test(key) ? value : `${value} ${marker}`;
  if (Array.isArray(value)) return value.map((v) => marked(v, marker, key));
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, marked(v, marker, k)]));
  return value;
}

/** A pin that keeps every item the engine reads in the record today: it holds until the engine, or the record, changes. */
export function pinOf(record: Record<string, unknown>, over: { note?: string; at?: string; pinnedWith?: string } = {}): EvalCase {
  const callId = record.call_id as string;
  const out = analyzeRetellCall(record, { tz: TZ });
  if (out.kind !== "report") throw new Error("the fixture record gives no report");
  const contracts: Partial<Record<ContractId, Result>> = {};
  for (const r of out.report.results) contracts[r.contract] = r.result;
  const experience: Partial<Record<ExperienceCheckId, ExperienceExpect>> = {};
  for (const check of out.report.experience.ran) experience[check] = out.report.experience.problems.some((p) => p.check === check) ? "problem" : "clean";
  return parseCase({
    schemaVersion: 1,
    id: pinIdFor(callId),
    source: "real",
    independent: false,
    platform: "retell",
    locked: true,
    label: { by: "you", at: over.at ?? "2026-11-08T10:15:00-05:00", ...(over.note === undefined ? {} : { note: over.note }) },
    tz: TZ,
    pin: { callId, agentId: "agent_1", agentVersion: "3", pinnedWith: over.pinnedWith ?? "0.1.0" },
    expect: { verdict: out.report.verdict, contracts, experience },
    record,
  });
}

/** The failed sample as a pin that holds: verdict failed, transfer_kept violated. */
export const failedPin = (callId = "call_8f2a9c", note?: string): EvalCase => pinOf(recordOf(failedSample, callId), { note });
/** The passed sample as a pin that holds. */
export const passedPin = (callId = "call_c41d07"): EvalCase => pinOf(recordOf(passedSample, callId));

/** What a call's screen shows, as a client would send it in `saw`: the verdict and the result of every contract and check. */
export function sawOf(record: unknown, tz: string = Intl.DateTimeFormat().resolvedOptions().timeZone): {
  verdict: Verdict;
  contracts: Partial<Record<ContractId, Result>>;
  experience: Partial<Record<ExperienceCheckId, ExperienceExpect>>;
} {
  const out = analyzeRetellCall(record, { tz });
  if (out.kind !== "report") throw new Error("the fixture record gives no report");
  const { report } = out;
  return {
    verdict: report.verdict,
    contracts: Object.fromEntries(report.results.map((r) => [r.contract, r.result])) as Partial<Record<ContractId, Result>>,
    experience: Object.fromEntries(report.experience.ran.map((c) => [c, report.experience.problems.some((p) => p.check === c) ? "problem" : "clean"])) as Partial<Record<ExperienceCheckId, ExperienceExpect>>,
  };
}

/** recordOf with an agent id, as Retell's calls always carry one. A pin from the app is refused without it. */
export function agentRecordOf(sample: typeof failedSample, callId: string, agentId = "agent_1"): Record<string, unknown> {
  return { ...recordOf(sample, callId), agent_id: agentId };
}
