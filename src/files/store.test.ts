// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeRecord } from "@/engine/analyze";
import type { CallReport } from "@/report/schema";
import { MAX_CALLS } from "./labels";
import { addProblem, addReport, clearFiles, fileCount, getFileReport, hasFiles, listFiles, suffixOf } from "./store";

const record = JSON.parse(fs.readFileSync(path.join(process.cwd(), "eval/engine/cases/livekit-booked-no-tool.json"), "utf8")).record as unknown;
function report(callId = "AJ_one"): CallReport {
  const outcome = analyzeRecord(record, { tz: "UTC" });
  if (outcome.kind !== "report") throw new Error("fixture must give a report");
  return { ...outcome.report, callId, evidence: { ...outcome.report.evidence, callId } };
}

beforeEach(clearFiles);
afterEach(clearFiles);

describe("the files store", () => {
  it("keys a call by its call id", () => {
    expect(addReport("a.json", report("AJ_one"))).toBe("added");
    expect(getFileReport("AJ_one")?.callId).toBe("AJ_one");
    expect(listFiles().rows.map((r) => r.callId)).toEqual(["AJ_one"]);
    expect(listFiles().rows[0].file).toBeUndefined();
  });

  it("keeps a second file with the same call id under the call id plus a suffix from its name, and names both files on their rows", () => {
    addReport("first.json", report("AJ_one"));
    addReport("Second copy (2).json", report("AJ_one"));
    expect(fileCount()).toBe(2);
    expect(getFileReport("AJ_one~Secondco")).toBeDefined();
    const rows = listFiles().rows;
    expect(rows.map((r) => r.callId).sort()).toEqual(["AJ_one", "AJ_one~Secondco"]);
    expect(rows.map((r) => r.file).sort()).toEqual(["Second copy (2).json", "first.json"]);
  });

  it("gives a third file with the same suffix a number, and never overwrites another file's call", () => {
    addReport("a.json", report("AJ_one"));
    addReport("b.json", report("AJ_one"));
    addReport("b.JSON", report("AJ_one"));
    expect(fileCount()).toBe(3);
    expect(listFiles().rows.map((r) => r.callId).sort()).toEqual(["AJ_one", "AJ_one~b", "AJ_one~b-2"]);
  });

  it("replaces a file's call when the same file name is opened again", () => {
    addReport("a.json", report("AJ_one"));
    addReport("a.json", report("AJ_one"));
    expect(fileCount()).toBe(1);
    addReport("a.json", report("AJ_two"));
    expect(listFiles().rows.map((r) => r.callId)).toEqual(["AJ_two"]);
  });

  it("holds MAX_CALLS calls and refuses the next new one, but still replaces", () => {
    for (let i = 0; i < MAX_CALLS; i++) expect(addReport(`f${i}.json`, report(`AJ_${i}`))).toBe("added");
    expect(addReport("late.json", report("AJ_late"))).toBe("full");
    expect(fileCount()).toBe(MAX_CALLS);
    expect(getFileReport("AJ_late")).toBeUndefined();
    expect(addReport("f0.json", report("AJ_0"))).toBe("added");
    expect(fileCount()).toBe(MAX_CALLS);
  });

  it("keeps a note for a file that was set aside, and drops it when that file opens fine later", () => {
    addProblem("bad.json", "not_json");
    addProblem("bad.json", "not_a_report");
    expect(listFiles().problems).toEqual([{ file: "bad.json", reason: "not_a_report" }]);
    expect(hasFiles()).toBe(true);
    addReport("bad.json", report("AJ_one"));
    expect(listFiles().problems).toEqual([]);
  });

  it("clears calls and notes", () => {
    addReport("a.json", report());
    addProblem("b.json", "not_json");
    clearFiles();
    expect(hasFiles()).toBe(false);
    expect(listFiles()).toEqual({ rows: [], problems: [] });
  });

  it("makes a short suffix from a file name", () => {
    expect(suffixOf("session report 1.json")).toBe("sessionr");
    expect(suffixOf("....json")).toBe("file");
    expect(suffixOf("a.b.json")).toBe("ab");
  });
});
