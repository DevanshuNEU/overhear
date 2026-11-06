// npm run eval:engine: runs every case in eval/engine/cases/ through the engine and writes
// eval/engine-report.json and eval/engine-report.md. Both are committed; a test fails when they are stale.
//
// --write-sample-cases first rewrites the three sample cases from src/report/samples (testing/sample-cases.ts).
//
// It exits 0 when cases fail: the report says so, and CI gates on the tests (locks, freshness), not on this.
import fs from "node:fs";
import path from "node:path";
import { engine, engineLabel } from "@/engine/eval/engine";
import { sampleCases } from "@/engine/testing/sample-cases";
import { REPORT_JSON, REPORT_MD, REPO_ROOT, freshReport, writeCase } from "./engine-evals/io";

try {
  if (process.argv.includes("--write-sample-cases")) {
    for (const c of sampleCases()) writeCase(c);
    console.log("wrote the sample cases");
  }
  const { report, json, md } = freshReport(engine, engineLabel(engine));
  fs.writeFileSync(path.join(REPO_ROOT, REPORT_JSON), json);
  fs.writeFileSync(path.join(REPO_ROOT, REPORT_MD), md);
  const passing = report.cases.filter((c) => c.pass).length;
  console.log(`engine eval: ${passing} of ${report.cases.length} cases passing. Engine: ${report.engine}.`);
  console.log(`wrote ${REPORT_JSON} and ${REPORT_MD}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
