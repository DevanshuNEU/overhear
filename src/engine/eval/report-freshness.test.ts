// @vitest-environment node
// The committed engine report is fresh: it covers the current case files and engine sources, and it is what a
// run would write now. Mirrors src/eval/report-freshness.test.ts for the old judge. "Older than the cases or the
// engine" is checked by content, not file times: a fingerprint of every input, which git checkouts cannot fake.
// When this fails, run `npm run eval:engine` and commit both report files.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPORT_JSON, REPORT_MD, REPO_ROOT, fingerprint, freshReport } from "../../../scripts/engine-evals/io";
import { engine, engineLabel } from "./engine";

const read = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const FIX = "Run npm run eval:engine and commit eval/engine-report.json and eval/engine-report.md.";

describe("the committed engine eval report is fresh", () => {
  it("covers the current cases and engine sources", () => {
    const committed = JSON.parse(read(REPORT_JSON)) as { inputs: { fingerprint: string } };
    expect(committed.inputs.fingerprint, `A case or an engine source changed since the report was written. ${FIX}`).toBe(fingerprint());
  });

  it("matches a fresh run, in both files", () => {
    const fresh = freshReport(engine, engineLabel(engine));
    expect(read(REPORT_JSON), `The report differs from a fresh run. ${FIX}`).toBe(fresh.json);
    expect(read(REPORT_MD), `The Markdown report differs from a fresh run. ${FIX}`).toBe(fresh.md);
  });
});
