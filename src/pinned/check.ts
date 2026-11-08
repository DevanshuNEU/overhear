// Re-checks pinned calls: pins in, results out. Pure, like the engine: it reads no file, no clock and no key, and makes no
// network request. Reading the folder and printing are done by scripts/check-pinned.ts and src/pinned/format.ts.
//
// A pin holds only when the engine returns a report and every item the pin kept still reads the same: the verdict, each
// ticked contract and each ticked call experience check. This is runCase's `pass`, never brokenLock, which looks at the
// verdict alone. (A pin's citations are not checked in v1.) A result keeps the engine's error message apart from the rest,
// since an engine message can quote the record: only `--verbose` ever prints it.
import type { ExperienceExpect } from "@/engine/eval/case";
import { runCase, type ActualExperience, type ActualResult, type ActualVerdict } from "@/engine/eval/run";
import type { Analyze } from "@/engine/types";
import type { ContractId, ExperienceCheckId, Result, Verdict } from "@/report/schema";
import type { PinEntry } from "./store";

/** One kept item that reads differently now: the verdict, a contract, an experience check or a citation, with what it was and is. */
export type Change = { what: "verdict" | "contract" | "experience" | "citation"; name: string; was: string; now: string };

export type PinCheck = {
  id: string;
  callId: string;
  /** When it was pinned, as the pin's label says it (a date, or a date and time with an offset). */
  pinnedAt: string;
  pinnedWith: string;
  note: string | null;
  status: "held" | "changed";
  expected: {
    verdict: Verdict;
    contracts: Partial<Record<ContractId, Result>>;
    experience: Partial<Record<ExperienceCheckId, ExperienceExpect>>;
  };
  actual: {
    verdict: ActualVerdict;
    contracts: Partial<Record<ContractId, ActualResult>>;
    experience: Partial<Record<ExperienceCheckId, ActualExperience>>;
  };
  changes: Change[];
  /** The engine's own message for an error outcome. It can quote the call, so it is printed only on request. */
  message: string | null;
};

/** The pins through the engine, in the order given, each in the time zone it was pinned in. */
export function checkPins(entries: readonly PinEntry[], analyze: Analyze): PinCheck[] {
  return entries.map(({ id, pin }) => {
    const r = runCase(pin, analyze);
    const changes: Change[] = [];
    if (!r.verdictMatch) changes.push({ what: "verdict", name: "verdict", was: r.expected, now: r.actual });
    for (const c of r.contracts) if (!c.agree) changes.push({ what: "contract", name: c.contract, was: c.expected, now: c.actual });
    for (const c of r.experience) if (!c.agree) changes.push({ what: "experience", name: c.check, was: c.expected, now: c.actual });
    // The app never writes a citation expectation, but a hand-edited pin can carry one, and pass counts it.
    for (const m of r.mustCite) if (!m.ok) changes.push({ what: "citation", name: m.contract, was: "cited", now: "not cited" });

    const contracts: PinCheck["actual"]["contracts"] = {};
    for (const c of r.contracts) contracts[c.contract] = c.actual;
    const experience: PinCheck["actual"]["experience"] = {};
    for (const c of r.experience) experience[c.check] = c.actual;

    return {
      id,
      callId: pin.pin?.callId ?? "",
      pinnedAt: pin.label.at,
      pinnedWith: pin.pin?.pinnedWith ?? "",
      note: pin.label.note ?? null,
      // pass looks at every kept item. A verdict that matches while a kept contract or check does not is still a change.
      status: r.pass ? "held" : "changed",
      expected: { verdict: r.expected, contracts: pin.expect.contracts ?? {}, experience: pin.expect.experience ?? {} },
      actual: { verdict: r.actual, contracts, experience },
      changes,
      message: r.outcome === "error" ? r.message : null,
    };
  });
}

/** The ids that more than one entry carries, each once. */
export function duplicateIds(entries: readonly PinEntry[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const { id } of entries) (seen.has(id) ? dupes : seen).add(id);
  return [...dupes];
}
