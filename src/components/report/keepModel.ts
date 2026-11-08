// What the "Keep as a test" control lists for one report, and what it sends. Pure, so the rules are tested apart from the screen.
// Contracts that broke or could not be checked, and every experience problem, start ticked. Contracts that held or did not apply,
// and experience checks that found nothing, are listed unticked. A rule that was not checked has nothing to keep and is not listed.
import type { ExperienceExpect } from "@/engine/eval/case";
import type { CallReport, ContractId, ExperienceCheckId, Result, Verdict } from "@/report/schema";

export type ContractItem = { id: ContractId; result: Result; ticked: boolean };
export type ExperienceItem = { id: ExperienceCheckId; result: ExperienceExpect; ticked: boolean };

export type KeepItems = { verdict: Verdict; contracts: ContractItem[]; experience: ExperienceItem[] };

const KEEPABLE: Result[] = ["violated", "unverified", "passed", "not_applicable"];
const STARTS_TICKED: Result[] = ["violated", "unverified"];

export function keepItemsOf(report: CallReport): KeepItems {
  const contracts = report.results
    .filter((r) => KEEPABLE.includes(r.result))
    .map((r) => ({ id: r.contract, result: r.result, ticked: STARTS_TICKED.includes(r.result) }));
  const experience = report.experience.ran.map((id): ExperienceItem => {
    const result: ExperienceExpect = report.experience.problems.some((p) => p.check === id) ? "problem" : "clean";
    return { id, result, ticked: result === "problem" };
  });
  return { verdict: report.verdict, contracts, experience };
}

/** The key of a ticked item in the set the screen keeps. */
export const tickKey = (group: "contracts" | "experience", id: string): string => `${group}:${id}`;

/** The body of POST /api/pins: what is ticked, and what the screen showed (the verdict and the result of every listed item). */
export function pinBody(callId: string, items: KeepItems, ticked: ReadonlySet<string>, note: string) {
  const text = note.trim();
  return {
    callId,
    keep: {
      contracts: items.contracts.filter((c) => ticked.has(tickKey("contracts", c.id))).map((c) => c.id),
      experience: items.experience.filter((c) => ticked.has(tickKey("experience", c.id))).map((c) => c.id),
    },
    ...(text ? { note: text } : {}),
    saw: {
      verdict: items.verdict,
      contracts: Object.fromEntries(items.contracts.map((c) => [c.id, c.result])),
      experience: Object.fromEntries(items.experience.map((c) => [c.id, c.result])),
    },
  };
}

/** The ticks a fresh list starts with. */
export function startTicks(items: KeepItems): Set<string> {
  return new Set([
    ...items.contracts.filter((c) => c.ticked).map((c) => tickKey("contracts", c.id)),
    ...items.experience.filter((c) => c.ticked).map((c) => tickKey("experience", c.id)),
  ]);
}
