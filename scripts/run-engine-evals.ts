// npm run eval:engine: runs every case in eval/engine/cases/ through the engine and writes
// eval/engine-report.json and eval/engine-report.md. Both are committed; a test fails when they are stale.
//
// --write-sample-cases first rewrites the three sample cases from src/report/samples (testing/sample-cases.ts).
// --write-mutation-cases rewrites the mutation cases from the three samples (testing/mutations.ts). Run it after the
// samples or the mutations change; it writes the samples first when both flags are given.
//
// It exits 0 when cases fail: the report says so, and CI gates on the tests (locks, freshness), not on this.
import fs from "node:fs";
import path from "node:path";
import { engine, engineLabel } from "@/engine/eval/engine";
import { mutationCases } from "@/engine/testing/mutations";
import { sampleCases } from "@/engine/testing/sample-cases";
import { CASES_DIR, REPORT_JSON, REPORT_MD, REPO_ROOT, freshReport, writeCase } from "./engine-evals/io";

try {
  if (process.argv.includes("--write-sample-cases")) {
    for (const c of sampleCases()) writeCase(c);
    console.log("wrote the sample cases");
  }
  if (process.argv.includes("--write-mutation-cases")) {
    // Only mut- files go, so a renamed or removed mutation leaves no stale case behind.
    const dir = path.join(REPO_ROOT, CASES_DIR);
    for (const f of fs.readdirSync(dir)) if (f.startsWith("mut-")) fs.rmSync(path.join(dir, f));
    for (const c of mutationCases()) writeCase(c);
    console.log("wrote the mutation cases");
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
