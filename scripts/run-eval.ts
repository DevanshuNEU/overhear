// Runs the judge over the gold set and writes eval/report.json. Real mode
// needs a live ANTHROPIC_API_KEY (makeJudge falls back to Claude with no JEV
// key). Pass --stub to run a deterministic, network-free judge instead: the
// resulting report is flagged `placeholder: true` and its model label is
// overwritten so it can never masquerade as a real judge run. Not run in CI:
// the committed report is the artifact the dashboard reads.
import { writeFileSync, mkdirSync } from "node:fs";
import { GOLD_SET } from "@/eval/gold/index";
import { runEval, buildReport } from "@/eval/harness";
import { makeJudge } from "@/judge/judge";
import { StubJudge } from "@/eval/stub-judge";

void (async () => {
  try {
    const stub = process.argv.includes("--stub");
    const judge = stub ? new StubJudge() : makeJudge();
    const run = await runEval(GOLD_SET, judge);
    const report = buildReport(GOLD_SET, run);
    if (stub) {
      report.placeholder = true;
      report.runs[0].judge.model = "stub-placeholder";
    }
    mkdirSync("eval", { recursive: true });
    writeFileSync("eval/report.json", JSON.stringify(report, null, 2) + "\n");
    console.log(`eval complete: ${GOLD_SET.length} cases, band accuracy ${report.runs[0].metrics.scoreCalibration.bandAccuracy}`);
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
