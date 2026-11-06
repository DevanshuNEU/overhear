// @vitest-environment node
// The committed cases in eval/engine/cases/: they load, the three sample cases still match the samples, the files
// are written by formatCase, and nothing under eval/engine/, the engine report or docs/evals.md has an em or en dash.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CASES_DIR, REPORT_JSON, REPORT_MD, REPO_ROOT, loadCases } from "../../../scripts/engine-evals/io";
import { sampleCases } from "../testing/sample-cases";
import { formatCase } from "./case";

const cases = loadCases();
const DASH = /[\u2014\u2013]/;

describe("the committed eval cases", () => {
  it("load, with unique ids and every parent present", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s is written by formatCase", (id, c) => {
    expect(fs.readFileSync(path.join(REPO_ROOT, CASES_DIR, `${id}.json`), "utf8")).toBe(formatCase(c));
  });

  it.each(sampleCases().map((c) => [c.id, c] as const))(
    "%s matches its sample (run npm run eval:engine -- --write-sample-cases after a sample changes)",
    (id, expected) => {
      expect(cases.find((c) => c.id === id)).toEqual(expected);
    },
  );
});

describe("no em or en dash", () => {
  const files = [
    ...(fs.readdirSync(path.join(REPO_ROOT, "eval/engine"), { recursive: true }) as string[]).map((f) => `eval/engine/${f.split(path.sep).join("/")}`),
    REPORT_JSON,
    REPORT_MD,
    "docs/evals.md",
  ].filter((f) => fs.statSync(path.join(REPO_ROOT, f)).isFile());

  it("the check sees both characters", () => {
    expect(DASH.test("a \u2014 b \u2013 c")).toBe(true);
  });

  it.each(files)("%s has none", (file) => {
    const lines = fs.readFileSync(path.join(REPO_ROOT, file), "utf8").split("\n");
    expect(lines.flatMap((line, i) => (DASH.test(line) ? [`line ${i + 1}`] : []))).toEqual([]);
  });
});
