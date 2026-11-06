// @vitest-environment node
import { describe, expect, it } from "vitest";
import { failedSample } from "@/report/samples";
import { m1View } from "../testing/build";
import type { Analyze } from "../types";
import { parseCase, type EvalCase } from "./case";
import { engineLabel, engineNotBuiltYet } from "./engine";
import { buildEngineReport, renderReportMarkdown } from "./report";
import { runEngineEval } from "./run";

function makeCase(id: string, verdict: EvalCase["expect"]["verdict"], independent = false): EvalCase {
  return parseCase({
    schemaVersion: 1,
    id,
    source: independent ? "external" : "real",
    independent,
    platform: "retell",
    locked: true,
    label: { by: "test", at: "2026-11-06" },
    expect: { verdict, contracts: { transfer_kept: verdict === "failed" ? "violated" : "not_applicable" } },
    record: { call_id: id },
  });
}

const cases = [makeCase("a-failed", "failed"), makeCase("b-passed", "passed")];
const meta = { engine: "stand-in (engine not built yet)", fingerprint: "abc123" };

describe("buildEngineReport", () => {
  const report = buildEngineReport(runEngineEval(cases, engineNotBuiltYet), meta);

  it("records the engine, the inputs it covers, the metrics and every case", () => {
    expect(report.schemaVersion).toBe(1);
    expect(report.engine).toBe("stand-in (engine not built yet)");
    expect(report.inputs).toEqual({ cases: 2, fingerprint: "abc123" });
    expect(report.cases.map((c) => c.id)).toEqual(["a-failed", "b-passed"]);
    expect(report.metrics.constructed.n).toBe(2);
    expect(report.metrics.independent.n).toBe(0);
  });

  it("has no pooled figure: only independent and constructed groups", () => {
    expect(Object.keys(report.metrics)).toEqual(["independent", "constructed"]);
  });

  it("is plain JSON: a round trip changes nothing", () => {
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});

describe("renderReportMarkdown", () => {
  const md = (analyze: Analyze) =>
    renderReportMarkdown(buildEngineReport(runEngineEval(cases, analyze), { engine: engineLabel(analyze), fingerprint: "abc123" }));

  it("names the stand-in at the top, so nobody reads the numbers as the engine's", () => {
    expect(md(engineNotBuiltYet)).toMatch(/^# Engine eval report\n[\s\S]*Engine: stand-in \(engine not built yet\)/);
  });

  it("shows the independent and constructed groups under their own headings, never one pooled table", () => {
    const out = md(engineNotBuiltYet);
    expect(out).toContain("## Independent data");
    expect(out).toContain("## Constructed data");
    expect(out).not.toMatch(/all data|pooled total|overall total/i);
  });

  it("says an empty group has no cases", () => {
    expect(md(engineNotBuiltYet)).toMatch(/## Independent data\n\nNo cases yet\./);
  });

  it("shows k of n on every rate and no data for n = 0, never 0% or 100% without data", () => {
    const out = md(engineNotBuiltYet);
    expect(out).toContain("| Verdict accuracy | 0% (0 of 2) | 2 | 0% to 66% |");
    expect(out).toContain("| Precision of failed | no data | 0 | none |");
    expect(out).toContain("| False failed on normal calls | no data | 0 | none |");
    expect(out).toContain("| transfer_kept | 2 | 0% (0 of 2) | no data (n = 0) |");
  });

  it("lists every case with what it expected and what the engine said", () => {
    const out = md(engineNotBuiltYet);
    expect(out).toContain("| a-failed | constructed | real | yes | failed | error: engine not built yet | no |");
  });

  it("shows a real engine's verdicts and passes", () => {
    const real: Analyze = () => ({ kind: "report", report: m1View(failedSample) });
    const out = md(real);
    expect(out).toContain("Engine: analyzeRetellCall");
    expect(out).toContain("| a-failed | constructed | real | yes | failed | failed | yes |");
    expect(out).toContain("| Verdict accuracy | 50% (1 of 2) | 2 |");
  });

  it("keeps a pipe in an error message from breaking the table", () => {
    const out = md(() => ({ kind: "error", callId: null, message: "a | b" }));
    expect(out).toContain("error: a \\| b");
  });

  it("contains no em or en dash", () => {
    expect(md(engineNotBuiltYet)).not.toMatch(/[\u2014\u2013]/);
  });
});
