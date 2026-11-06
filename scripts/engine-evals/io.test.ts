// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fingerprint, inputFiles, loadCases } from "./io";

let root: string;
const write = (rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};
const caseJson = (id: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    schemaVersion: 1,
    id,
    source: "real",
    independent: false,
    platform: "retell",
    locked: true,
    label: { by: "test", at: "2026-11-06" },
    expect: { verdict: "passed" },
    record: { call_id: id },
    ...over,
  });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "engine-evals-"));
  write("eval/engine/cases/b-case.json", caseJson("b-case"));
  write("eval/engine/cases/a-case.json", caseJson("a-case"));
  write("src/engine/types.ts", "export {};\n");
  write("src/engine/contracts/x.ts", "export const x = 1;\n");
  write("src/engine/presets/p.json", "{}\n");
  write("src/engine/x.test.ts", "test\n");
  write("src/engine/testing/build.ts", "helper\n");
  write("src/engine/fixtures/retell/docs.json", "{}\n");
  write("src/report/schema.ts", "schema\n");
  write("src/report/labels.ts", "labels\n");
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("loadCases", () => {
  it("reads every case file in name order", () => {
    expect(loadCases(root).map((c) => c.id)).toEqual(["a-case", "b-case"]);
  });

  it("ignores files that are not JSON", () => {
    write("eval/engine/cases/README.txt", "notes");
    expect(loadCases(root)).toHaveLength(2);
  });

  it("names the file when a case is invalid", () => {
    write("eval/engine/cases/c-case.json", caseJson("c-case", { locked: "yes" }));
    expect(() => loadCases(root)).toThrow(/eval\/engine\/cases\/c-case\.json is not a valid eval case[\s\S]*locked/);
  });

  it("names the file when it is not JSON", () => {
    write("eval/engine/cases/c-case.json", "{ nope");
    expect(() => loadCases(root)).toThrow(/eval\/engine\/cases\/c-case\.json is not JSON/);
  });

  it("requires the file name to be the case id", () => {
    write("eval/engine/cases/other-name.json", caseJson("c-case"));
    expect(() => loadCases(root)).toThrow(/other-name\.json holds case c-case; name it c-case\.json/);
  });

  it("refuses a mutation whose parent is missing", () => {
    write("eval/engine/cases/m-case.json", caseJson("m-case", { source: "mutation", derivedFrom: "gone" }));
    expect(() => loadCases(root)).toThrow(/m-case is derived from gone, which is not a case/);
  });
});

describe("inputFiles and fingerprint", () => {
  it("cover the cases, the engine's sources and the report schema, and leave out tests, testing/ and fixtures/", () => {
    expect(inputFiles(root)).toEqual([
      "eval/engine/cases/a-case.json",
      "eval/engine/cases/b-case.json",
      "src/engine/contracts/x.ts",
      "src/engine/presets/p.json",
      "src/engine/types.ts",
      "src/report/schema.ts",
    ]);
  });

  it("is stable for the same files", () => {
    expect(fingerprint(root)).toBe(fingerprint(root));
    expect(fingerprint(root)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["a case changes", "eval/engine/cases/a-case.json", caseJson("a-case", { locked: false })],
    ["a case is added", "eval/engine/cases/c-case.json", caseJson("c-case")],
    ["an engine source changes", "src/engine/contracts/x.ts", "export const x = 2;\n"],
    ["the report schema changes", "src/report/schema.ts", "schema v2\n"],
  ])("changes when %s", (_what, rel, body) => {
    const before = fingerprint(root);
    write(rel, body);
    expect(fingerprint(root)).not.toBe(before);
  });

  it.each([
    ["a test changes", "src/engine/x.test.ts"],
    ["a testing/ helper changes", "src/engine/testing/build.ts"],
    ["a test fixture changes", "src/engine/fixtures/retell/docs.json"],
    ["the labels change", "src/report/labels.ts"],
  ])("stays the same when %s", (_what, rel) => {
    const before = fingerprint(root);
    write(rel, "changed\n");
    expect(fingerprint(root)).toBe(before);
  });

  it("ignores Windows line endings", () => {
    const before = fingerprint(root);
    write("src/engine/types.ts", "export {};\r\n");
    expect(fingerprint(root)).toBe(before);
  });
});
