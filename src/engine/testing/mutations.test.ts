// @vitest-environment node
// The mutation suite: each mutation is a valid case, the engine says what the rules say for each (or the case is a
// listed known failure), the committed files are what the code writes, and the suite covers every contract the
// engine runs and every gap code the engine emits. A new gap code or contract fails the coverage tests until it
// has a mutation.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CASES_DIR, REPO_ROOT, loadCases } from "../../../scripts/engine-evals/io";
import { CONTRACT_IDS, GAP_CODES, type CallReport, type ContractId, type GapCode, type Result } from "@/report/schema";
import { EvalCaseSchema, formatCase, checkCaseSet, type EvalCase } from "../eval/case";
import { engine } from "../eval/engine";
import { engineMetrics } from "../eval/metrics";
import { outcomeOf, runCase, runEngineEval } from "../eval/run";
import { CONTRACTS_NOT_RUN_IN_M1, GAP_CODES_NOT_EMITTED, KNOWN_FAILURES, MUTATIONS, mutationCase, mutationCases } from "./mutations";
import { sampleCases } from "./sample-cases";

const cases = mutationCases();
const samples = sampleCases();
const byId = new Map(cases.map((c) => [c.id, c]));

/** The engine's report for a case; fails the test when there is none. */
function reportOf(c: EvalCase): CallReport {
  const out = outcomeOf(c, engine);
  if (out.kind !== "report") throw new Error(`${c.id}: the engine gave ${out.kind}`);
  return out.report;
}

const reports = new Map(cases.map((c) => [c.id, reportOf(c)]));
const RUNNING = CONTRACT_IDS.filter((c) => !CONTRACTS_NOT_RUN_IN_M1.includes(c));

describe("the mutations as cases", () => {
  it("have a unique id, a parent that is a sample, and a note", () => {
    expect(new Set(MUTATIONS.map((m) => m.id)).size).toBe(MUTATIONS.length);
    for (const m of MUTATIONS) {
      expect(m.id).toMatch(/^mut-[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(samples.map((s) => s.id)).toContain(m.parent);
      expect(m.note.length).toBeGreaterThan(40);
    }
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s is a valid, constructed, mutation case", (_id, c) => {
    expect(EvalCaseSchema.safeParse(c).success).toBe(true);
    expect(c).toMatchObject({ source: "mutation", independent: false, platform: "retell" });
    expect(c.derivedFrom).toMatch(/^sample-/);
    expect(c.label.by).toBe("mutation");
  });

  it("form a consistent case set with the samples", () => {
    expect(checkCaseSet([...samples, ...cases])).toEqual([]);
  });

  it("are written the same way twice, and never change the sample they came from", () => {
    const before = structuredClone(samples);
    expect(mutationCases()).toEqual(cases);
    expect(samples).toEqual(before);
    expect(sampleCases()).toEqual(before);
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s changes its parent's record", (_id, c) => {
    const parent = samples.find((s) => s.id === c.derivedFrom)!;
    // The call id always differs, so it is left out: the edit itself must change something.
    const withoutId = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).filter(([k]) => k !== "call_id"));
    expect(withoutId(c.record)).not.toEqual(withoutId(parent.record));
  });

  it("give every case a call id of its own", () => {
    const ids = [...samples, ...cases].map((c) => c.record.call_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reject an edit that does not apply, so a stale edit fails loudly", () => {
    const stale = { ...MUTATIONS[0], edit: () => { throw new Error("the turn is gone"); } };
    expect(() => mutationCase(stale)).toThrow("the turn is gone");
    expect(() => mutationCase({ ...MUTATIONS[0], parent: "sample-missing" as never })).toThrow(/not a sample case/);
  });
});

describe("the engine on each mutation", () => {
  const failing = new Set(Object.keys(KNOWN_FAILURES));

  it("lists only mutations that exist as known failures", () => {
    for (const id of failing) expect(byId.has(id), `${id} is in KNOWN_FAILURES but is not a mutation`).toBe(true);
  });

  it.each(MUTATIONS.filter((m) => !failing.has(m.id)).map((m) => [m.id, m] as const))("%s gets its expected verdict and results", (id, m) => {
    const r = runCase(byId.get(id)!, engine);
    expect(r.message).toBeNull();
    expect({ verdict: r.actual, contracts: r.contracts.filter((k) => !k.agree).map((k) => `${k.contract}: ${k.actual}`) }).toEqual({ verdict: m.expect.verdict, contracts: [] });
    expect(r.mustCite.filter((c) => !c.ok)).toEqual([]);
    const codes = new Set(reports.get(id)!.evidence.gaps.map((g) => g.code));
    for (const gap of m.gaps ?? []) expect(codes.has(gap), `${id} should list a ${gap} gap`).toBe(true);
    if (m.reasons !== undefined) expect(reports.get(id)!.reasons.map((x) => x.kind), `${id} reasons`).toEqual(m.reasons);
  });

  it.each([...failing].map((id) => [id] as const))("%s is a known failure: the engine still gets it wrong (remove it from KNOWN_FAILURES when fixed)", (id) => {
    const c = byId.get(id)!;
    expect(c.locked).toBe(false);
    expect(runCase(c, engine).pass).toBe(false);
  });

  it("locks every mutation that is not a known failure", () => {
    for (const c of cases) expect(c.locked).toBe(!failing.has(c.id));
  });
});

describe("coverage", () => {
  /** The expected result of a contract in a mutation, and in its parent. */
  const expected = (c: EvalCase, contract: ContractId): Result | undefined => c.expect.contracts?.[contract];
  const parentOf = (c: EvalCase): EvalCase => samples.find((s) => s.id === c.derivedFrom)!;

  it("every contract the engine runs has a mutation that changes its result", () => {
    for (const contract of RUNNING) {
      const changed = cases.filter((c) => expected(c, contract) !== expected(parentOf(c), contract));
      expect(changed.length, `no mutation changes ${contract}`).toBeGreaterThan(0);
    }
  });

  it("every contract the engine runs has a violated case and an unverified case", () => {
    for (const contract of RUNNING) {
      const seen = new Set(cases.map((c) => expected(c, contract)));
      expect(seen.has("violated"), `${contract} has no violated mutation`).toBe(true);
      expect(seen.has("unverified"), `${contract} has no unverified mutation`).toBe(true);
    }
  });

  it("transfer_kept has a mutation that passes, made from a call where it was violated", () => {
    const worked = cases.filter((c) => expected(c, "transfer_kept") === "passed" && expected(parentOf(c), "transfer_kept") === "violated");
    expect(worked.length).toBeGreaterThan(0);
  });

  it("every contract is either covered above or listed as not run in M1, and the list is true", () => {
    for (const contract of CONTRACT_IDS) expect(RUNNING.includes(contract) || CONTRACTS_NOT_RUN_IN_M1.includes(contract)).toBe(true);
    for (const contract of CONTRACTS_NOT_RUN_IN_M1) {
      for (const [id, report] of reports) {
        const result = report.results.find((r) => r.contract === contract)?.result;
        expect(result === undefined || result === "not_run", `${id} ran ${contract}, so it needs mutations and must leave CONTRACTS_NOT_RUN_IN_M1`).toBe(true);
      }
    }
  });

  it("the suite reaches every verdict", () => {
    expect(new Set(cases.map((c) => c.expect.verdict))).toEqual(new Set(["failed", "needs_review", "passed", "nothing_done"]));
  });

  const emitted = (): Set<GapCode> => new Set([...reports.values()].flatMap((r) => r.evidence.gaps.map((g) => g.code)));

  it("every gap code is produced by a mutation or listed as never emitted, and never both", () => {
    const codes = emitted();
    for (const code of GAP_CODES) {
      const listed = Object.hasOwn(GAP_CODES_NOT_EMITTED, code);
      expect(codes.has(code) || listed, `no mutation produces ${code}: add one, or list it in GAP_CODES_NOT_EMITTED with the reason`).toBe(true);
      expect(!(codes.has(code) && listed), `a mutation produces ${code}, so take it off GAP_CODES_NOT_EMITTED`).toBe(true);
    }
    for (const code of Object.keys(GAP_CODES_NOT_EMITTED)) expect(GAP_CODES as readonly string[]).toContain(code);
  });

  it("every gap code a mutation produces is one a mutation says it expects", () => {
    const declared = new Set(MUTATIONS.flatMap((m) => m.gaps ?? []));
    expect([...emitted()].filter((c) => !declared.has(c))).toEqual([]);
    expect([...declared].filter((c) => !emitted().has(c))).toEqual([]);
  });

  it("every gap code the engine emits has a mutation that asserts it", () => {
    for (const code of GAP_CODES.filter((c) => !Object.hasOwn(GAP_CODES_NOT_EMITTED, c))) {
      expect(MUTATIONS.some((m) => m.gaps?.includes(code)), `no mutation asserts ${code}`).toBe(true);
    }
  });
});

describe("the mutations in the eval report", () => {
  it("are constructed data: none counts as independent", () => {
    const metrics = engineMetrics(runEngineEval([...samples, ...cases], engine));
    expect(metrics.independent.n).toBe(0);
    expect(metrics.constructed.n).toBe(samples.length + cases.length);
    expect(metrics.constructed.sources.mutation).toBe(cases.length);
  });
});

describe("the committed mutation files", () => {
  const committed = loadCases();

  it.each(cases.map((c) => [c.id, c] as const))("%s matches its file (run npm run eval:engine -- --write-mutation-cases after changing a mutation)", (id, c) => {
    expect(committed.find((x) => x.id === id)).toEqual(c);
    expect(fs.readFileSync(path.join(REPO_ROOT, CASES_DIR, `${id}.json`), "utf8")).toBe(formatCase(c));
  });

  it("hold no mutation file the code does not write", () => {
    const files = fs.readdirSync(path.join(REPO_ROOT, CASES_DIR)).filter((f) => f.startsWith("mut-"));
    expect(files.sort()).toEqual(cases.map((c) => `${c.id}.json`).sort());
  });
});
