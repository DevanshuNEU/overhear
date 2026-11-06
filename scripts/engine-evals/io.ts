// The file side of the engine eval: read the case files, fingerprint what the report covers, write the report.
// The engine and the runner stay pure; everything that touches the disk is here, used by
// scripts/run-engine-evals.ts and the report freshness test.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { checkCaseSet, formatCase, parseCase, type EvalCase } from "@/engine/eval/case";
import { compactJson } from "@/engine/eval/json";
import { buildEngineReport, renderReportMarkdown, type EngineReport } from "@/engine/eval/report";
import { runEngineEval } from "@/engine/eval/run";
import type { Analyze } from "@/engine/types";

export const REPO_ROOT = path.resolve(__dirname, "..", "..");
export const CASES_DIR = "eval/engine/cases";
export const REPORT_JSON = "eval/engine-report.json";
export const REPORT_MD = "eval/engine-report.md";

/** The JSON files directly in a directory, as paths from root, in name order. */
function jsonFiles(root: string, dir: string): string[] {
  return fs
    .readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => `${dir}/${f}`);
}

/** Every case in eval/engine/cases/, in file name order. Throws, naming the file, on anything wrong. */
export function loadCases(root = REPO_ROOT): EvalCase[] {
  const cases = jsonFiles(root, CASES_DIR).map((rel) => {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
    } catch (err) {
      throw new Error(`${rel} is not JSON: ${(err as Error).message}`);
    }
    const c = parseCase(raw, rel);
    const name = path.basename(rel);
    if (name !== `${c.id}.json`) throw new Error(`${rel} holds case ${c.id}; name it ${c.id}.json`);
    return c;
  });
  const problems = checkCaseSet(cases);
  if (problems.length > 0) throw new Error(`the eval cases do not fit together:\n${problems.join("\n")}`);
  return cases;
}

/**
 * The files whose content the report depends on, as sorted paths from root: the case files, the engine's own
 * sources (not tests, testing/ or fixtures/) and the report schema the runner validates against.
 */
export function inputFiles(root = REPO_ROOT): string[] {
  const engine = (fs.readdirSync(path.join(root, "src/engine"), { recursive: true }) as string[])
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => /\.(tsx?|json)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/^(testing|fixtures)\//.test(f))
    .map((f) => `src/engine/${f}`);
  return [...jsonFiles(root, CASES_DIR), ...engine, "src/report/schema.ts"].sort();
}

/** A sha256 over every input file's path and content, line endings normalized. Changes when any input does. */
export function fingerprint(root = REPO_ROOT): string {
  const hash = crypto.createHash("sha256");
  for (const rel of inputFiles(root)) {
    hash.update(`${rel}\0${fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n")}\0`);
  }
  return hash.digest("hex");
}

/** A fresh run of every case through the engine, as the report object and the two files' text. */
export function freshReport(analyze: Analyze, engineLabel: string, root = REPO_ROOT): { report: EngineReport; json: string; md: string } {
  const report = buildEngineReport(runEngineEval(loadCases(root), analyze), { engine: engineLabel, fingerprint: fingerprint(root) });
  return { report, json: compactJson(report), md: renderReportMarkdown(report) };
}

/** Writes one case to eval/engine/cases/<id>.json. */
export function writeCase(c: EvalCase, root = REPO_ROOT): void {
  fs.mkdirSync(path.join(root, CASES_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, CASES_DIR, `${c.id}.json`), formatCase(c));
}
