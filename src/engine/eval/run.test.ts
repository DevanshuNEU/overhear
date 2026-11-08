// @vitest-environment node
import { describe, expect, it } from "vitest";
import { failedSample, passedSample } from "@/report/samples";
import { m1View } from "../testing/build";
import type { Analyze, EngineOptions } from "../types";
import { parseCase, type EvalCase } from "./case";
import { DEFAULT_TZ, brokenLock, outcomeOf, runCase, runEngineEval } from "./run";

function makeCase(over: Partial<EvalCase> & { expect: EvalCase["expect"] }): EvalCase {
  return parseCase({
    schemaVersion: 1,
    id: "c1",
    source: "real",
    independent: false,
    platform: "retell",
    locked: true,
    label: { by: "test", at: "2026-11-06" },
    record: { call_id: "call_x" },
    ...over,
  });
}

const returns = (report: unknown): Analyze => () => ({ kind: "report", report }) as ReturnType<Analyze>;
const failedReport = m1View(failedSample);

describe("runCase", () => {
  it("hands the engine the case's record and time zone, and UTC when the case names none", () => {
    const seen: [unknown, EngineOptions][] = [];
    const spy: Analyze = (raw, opts) => {
      seen.push([raw, opts]);
      return { kind: "error", callId: null, message: "x" };
    };
    runCase(makeCase({ expect: { verdict: "failed" }, tz: "America/New_York" }), spy);
    runCase(makeCase({ expect: { verdict: "failed" } }), spy);
    expect(seen).toEqual([
      [{ call_id: "call_x" }, { tz: "America/New_York" }],
      [{ call_id: "call_x" }, { tz: DEFAULT_TZ }],
    ]);
    expect(DEFAULT_TZ).toBe("UTC");
  });

  it("passes a case whose verdict, labeled contracts and citations all match", () => {
    const r = runCase(
      makeCase({
        expect: {
          verdict: "failed",
          contracts: { transfer_kept: "violated", promise_backed: "passed" },
          mustCite: [{ contract: "transfer_kept", seqs: [25, 27] }],
        },
      }),
      returns(failedReport),
    );
    expect(r).toMatchObject({ outcome: "report", message: null, expected: "failed", actual: "failed", verdictMatch: true, pass: true });
    expect(r.contracts).toEqual([
      { contract: "promise_backed", expected: "passed", actual: "passed", agree: true },
      { contract: "transfer_kept", expected: "violated", actual: "violated", agree: true },
    ]);
    expect(r.mustCite).toEqual([{ contract: "transfer_kept", seqs: [25, 27], missing: [], ok: true }]);
  });

  it("records every contract the report returned, labeled or not", () => {
    const r = runCase(makeCase({ expect: { verdict: "failed" } }), returns(failedReport));
    expect(r.results).toEqual({
      promise_backed: "passed",
      spoken_matches_committed: "passed",
      transfer_kept: "violated",
      committed_matches_request: "not_run",
    });
  });

  it("fails a case whose verdict differs", () => {
    const r = runCase(makeCase({ expect: { verdict: "failed" } }), returns(m1View(passedSample)));
    expect(r).toMatchObject({ actual: "passed", verdictMatch: false, pass: false });
  });

  it("fails a case whose labeled contract differs, even when the verdict matches", () => {
    const r = runCase(makeCase({ expect: { verdict: "failed", contracts: { promise_backed: "violated" } } }), returns(failedReport));
    expect(r.verdictMatch).toBe(true);
    expect(r.contracts).toEqual([{ contract: "promise_backed", expected: "violated", actual: "passed", agree: false }]);
    expect(r.pass).toBe(false);
  });

  it("marks a labeled contract the report left out as missing", () => {
    const r = runCase(makeCase({ expect: { verdict: "failed", contracts: { verified_before_change: "passed" } } }), returns(failedReport));
    expect(r.contracts).toEqual([{ contract: "verified_before_change", expected: "passed", actual: "missing", agree: false }]);
  });

  it("fails a case whose findings do not cite a seq it must cite, and lists the missing seqs", () => {
    const r = runCase(makeCase({ expect: { verdict: "failed", mustCite: [{ contract: "transfer_kept", seqs: [25, 26, 29] }] } }), returns(failedReport));
    expect(r.mustCite).toEqual([{ contract: "transfer_kept", seqs: [25, 26, 29], missing: [26, 29], ok: false }]);
    expect(r.pass).toBe(false);
  });

  it("counts said, did and asked seqs as cited", () => {
    const r = runCase(makeCase({ expect: { verdict: "failed", mustCite: [{ contract: "promise_backed", seqs: [22, 24, 25] }] } }), returns(failedReport));
    expect(r.mustCite[0].ok).toBe(true);
  });

  it("keeps an error outcome as not passing, with its message, and every check failed", () => {
    const r = runCase(
      makeCase({ expect: { verdict: "failed", contracts: { transfer_kept: "violated" }, mustCite: [{ contract: "transfer_kept", seqs: [25] }] } }),
      () => ({ kind: "error", callId: null, message: "engine not built yet" }),
    );
    expect(r).toMatchObject({ outcome: "error", message: "engine not built yet", actual: "error", verdictMatch: false, pass: false, results: {} });
    expect(r.contracts).toEqual([{ contract: "transfer_kept", expected: "violated", actual: "no_report", agree: false }]);
    expect(r.mustCite).toEqual([{ contract: "transfer_kept", seqs: [25], missing: [25], ok: false }]);
  });

  it("keeps a no_content outcome as its own kind, with its reason as the message", () => {
    const r = runCase(makeCase({ expect: { verdict: "passed" } }), () => ({ kind: "no_content", callId: "call_x", reason: "storage_stripped" }));
    expect(r).toMatchObject({ outcome: "no_content", actual: "no_content", message: "storage_stripped", pass: false });
  });

  it("turns a report that does not validate into an error, never a verdict", () => {
    const bad = { ...failedReport, verdict: "passed" };
    const r = runCase(makeCase({ expect: { verdict: "passed" } }), returns(bad));
    expect(r.outcome).toBe("error");
    expect(r.message).toMatch(/^the engine returned a report that does not validate: /);
    expect(r.pass).toBe(false);
  });

  it("turns an engine that throws into an error outcome, and keeps going", () => {
    const r = runCase(makeCase({ expect: { verdict: "passed" } }), () => {
      throw new Error("boom");
    });
    expect(r).toMatchObject({ outcome: "error", message: "the engine threw: boom", pass: false });
  });

  it("gives its own error outcomes the record's call id, as the engine's Outcome does", () => {
    const throws: Analyze = () => {
      throw new Error("boom");
    };
    expect(outcomeOf(makeCase({ expect: { verdict: "passed" } }), throws)).toEqual({ kind: "error", callId: "call_x", message: "the engine threw: boom" });
    expect(outcomeOf(makeCase({ expect: { verdict: "passed" }, record: { no_id: true } }), throws)).toMatchObject({ callId: null });
    expect(outcomeOf(makeCase({ expect: { verdict: "passed" } }), returns({ bad: true }))).toMatchObject({ kind: "error", callId: "call_x" });
  });

  it("carries the case's id, source, independence and lock", () => {
    const r = runCase(makeCase({ id: "x-1", source: "external", independent: true, locked: false, expect: { verdict: "passed" } }), returns(failedReport));
    expect(r).toMatchObject({ id: "x-1", source: "external", independent: true, locked: false });
  });
});

describe("brokenLock", () => {
  const failedCase = (locked: boolean) => makeCase({ locked, expect: { verdict: "failed" } });

  it("is null when a locked case keeps its verdict", () => {
    expect(brokenLock(runCase(failedCase(true), returns(failedReport)))).toBeNull();
  });

  it("explains a locked case whose verdict changed, and how to change it on purpose", () => {
    expect(brokenLock(runCase(failedCase(true), returns(m1View(passedSample))))).toBe(
      "c1 is locked to failed, and the engine said passed. If passed is right, change expect.verdict in eval/engine/cases/c1.json and say why in label.note.",
    );
  });

  it("counts an error as a broken lock, with its message", () => {
    expect(brokenLock(runCase(failedCase(true), () => ({ kind: "error", callId: null, message: "boom" })))).toMatch(/the engine said error \(boom\)/);
  });

  it("is null for an unlocked case, whatever the engine said", () => {
    expect(brokenLock(runCase(failedCase(false), returns(m1View(passedSample))))).toBeNull();
  });

  it("holds the lock on the verdict only: a contract or citation miss is measured, not locked", () => {
    const c = makeCase({ expect: { verdict: "failed", contracts: { promise_backed: "violated" } } });
    const r = runCase(c, returns(failedReport));
    expect(r.pass).toBe(false);
    expect(brokenLock(r)).toBeNull();
  });
});

describe("runEngineEval", () => {
  it("runs every case, in order", () => {
    const cases = [makeCase({ id: "a", expect: { verdict: "failed" } }), makeCase({ id: "b", expect: { verdict: "passed" } })];
    expect(runEngineEval(cases, returns(failedReport)).map((r) => [r.id, r.pass])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("gives the same results on a second run", () => {
    const cases = [makeCase({ id: "a", expect: { verdict: "failed" } })];
    expect(runEngineEval(cases, returns(failedReport))).toEqual(runEngineEval(cases, returns(failedReport)));
  });
});

describe("runCase, kept experience checks", () => {
  // The failed sample's report with an experience block: two checks ran, one problem found.
  const agentSeq = failedReport.evidence.items.find((e) => e.kind === "turn" && e.role === "agent")?.seq ?? 0;
  const withExperience = (experience: { ran: string[]; problems: { check: string; text: string; seqs: number[] }[] }): Analyze =>
    returns({ ...failedReport, experience });
  const found = withExperience({ ran: ["agent_ends_call", "error_handled"], problems: [{ check: "agent_ends_call", text: "The agent kept talking.", seqs: [agentSeq] }] });

  it("passes a kept problem the engine reports and a kept clean check the engine ran", () => {
    const r = runCase(makeCase({ expect: { verdict: "failed", experience: { agent_ends_call: "problem", error_handled: "clean" } } }), found);
    expect(r.experience).toEqual([
      { check: "agent_ends_call", expected: "problem", actual: "problem", agree: true },
      { check: "error_handled", expected: "clean", actual: "clean", agree: true },
    ]);
    expect(r.pass).toBe(true);
  });

  it("disagrees, and fails the case, when a kept problem is not reported", () => {
    const r = runCase(makeCase({ expect: { verdict: "failed", experience: { error_handled: "problem" } } }), found);
    expect(r.experience).toEqual([{ check: "error_handled", expected: "problem", actual: "clean", agree: false }]);
    expect(r.verdictMatch).toBe(true);
    expect(r.pass).toBe(false);
  });

  it("disagrees when a kept clean check found a problem", () => {
    const r = runCase(makeCase({ expect: { verdict: "failed", experience: { agent_ends_call: "clean" } } }), found);
    expect(r.experience).toEqual([{ check: "agent_ends_call", expected: "clean", actual: "problem", agree: false }]);
    expect(r.pass).toBe(false);
  });

  it("reads a kept check missing from ran as not_run, which disagrees even for clean", () => {
    const r = runCase(makeCase({ expect: { verdict: "failed", experience: { spoken_format: "clean" } } }), found);
    expect(r.experience).toEqual([{ check: "spoken_format", expected: "clean", actual: "not_run", agree: false }]);
    expect(r.pass).toBe(false);
  });

  it("reads a report from before the experience checks as not_run", () => {
    const r = runCase(makeCase({ expect: { verdict: "failed", experience: { agent_ends_call: "problem" } } }), returns({ ...failedReport, experience: undefined }));
    expect(r.experience).toEqual([{ check: "agent_ends_call", expected: "problem", actual: "not_run", agree: false }]);
  });

  it("reads no_report when the outcome is not a report", () => {
    const r = runCase(makeCase({ expect: { verdict: "failed", experience: { agent_ends_call: "problem" } } }), () => ({ kind: "error", callId: null, message: "x" }));
    expect(r.experience).toEqual([{ check: "agent_ends_call", expected: "problem", actual: "no_report", agree: false }]);
  });

  it("scores nothing when a case keeps no experience checks, and lists the checks in the schema's order", () => {
    expect(runCase(makeCase({ expect: { verdict: "failed" } }), found).experience).toEqual([]);
    const r = runCase(makeCase({ expect: { verdict: "failed", experience: { spoken_format: "clean", agent_ends_call: "problem" } } }), found);
    expect(r.experience.map((k) => k.check)).toEqual(["agent_ends_call", "spoken_format"]);
  });
});
