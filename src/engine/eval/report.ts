// The eval report: eval/engine-report.json (everything) and eval/engine-report.md (a short table people read).
// Pure: the script supplies the engine's label and the fingerprint of the inputs, and writes the files.
// Every number in the Markdown shows its n, and independent and constructed data get their own sections.
import { CONTRACT_IDS, VERDICTS } from "@/report/schema";
import { engineMetrics, type EngineMetrics, type GroupMetrics, type Rate } from "./metrics";
import type { CaseResult } from "./run";

export const ENGINE_REPORT_SCHEMA_VERSION = 1;

export interface EngineReport {
  schemaVersion: typeof ENGINE_REPORT_SCHEMA_VERSION;
  /** The engine that ran, or the stand-in. */
  engine: string;
  /** What the report covers: the number of cases, and a hash of the case files and engine sources. */
  inputs: { cases: number; fingerprint: string };
  metrics: EngineMetrics;
  cases: CaseResult[];
}

export function buildEngineReport(results: CaseResult[], meta: { engine: string; fingerprint: string }): EngineReport {
  return {
    schemaVersion: ENGINE_REPORT_SCHEMA_VERSION,
    engine: meta.engine,
    inputs: { cases: results.length, fingerprint: meta.fingerprint },
    metrics: engineMetrics(results),
    cases: results,
  };
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** "71% (97 of 123)", or "no data" when n = 0. */
function value(r: Rate): string {
  return r.value === null ? "no data" : `${pct(r.value)} (${r.k} of ${r.n})`;
}

/** A table cell that carries its own n: "71% (97 of 123)" or "no data (n = 0)". */
function cell(r: Rate): string {
  return r.value === null ? `no data (n = ${r.n})` : value(r);
}

function interval(r: Rate): string {
  return r.ci === null ? "none" : `${pct(r.ci[0])} to ${pct(r.ci[1])}`;
}

/** Text safe inside a Markdown table cell. */
const esc = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

const row = (cells: (string | number)[]): string => `| ${cells.join(" | ")} |`;
const header = (cells: string[]): string[] => [row(cells), row(cells.map(() => "---"))];

function groupSection(title: string, g: GroupMetrics): string[] {
  const out = [`## ${title}`, ""];
  if (g.n === 0) return [...out, "No cases yet.", ""];

  const sources = Object.entries(g.sources).map(([s, n]) => `${s} ${n}`).join(", ");
  out.push(
    `${g.n} cases (${sources}). Engine outcomes: ${g.outcomes.report} reports, ${g.outcomes.no_content} with no content, ${g.outcomes.error} errors.`,
    "",
    ...header(["Measure", "Value", "n", "95% interval"]),
  );
  const measures: [string, Rate][] = [
    ["Cases passing every check", g.passing],
    ["Verdict accuracy", g.overall.verdictAccuracy],
    ["Precision of failed", g.overall.failedPrecision],
    ["Recall of failed", g.overall.failedRecall],
    ["False failed on normal calls", g.overall.falseFailedRate],
  ];
  for (const [name, r] of measures) out.push(row([name, value(r), r.n, interval(r)]));

  out.push(
    "",
    ...header(["Contract", "Labeled n", "Agreement", "Precision of violated", "Recall of violated", "False violated on normal calls", "Unverified when it applied"]),
  );
  for (const c of CONTRACT_IDS) {
    const m = g.contracts[c];
    out.push(row([c, m.n, cell(m.agreement), cell(m.violatedPrecision), cell(m.violatedRecall), cell(m.falseViolatedRate), cell(m.unverifiedRate)]));
  }

  const cols = Object.keys(g.overall.confusion.failed);
  out.push("", "Verdicts, expected (rows) by what the engine said (columns):", "", ...header(["Expected", ...cols]));
  for (const v of VERDICTS) out.push(row([v, ...cols.map((col) => g.overall.confusion[v][col as keyof (typeof g.overall.confusion)[typeof v]])]));
  return [...out, ""];
}

function caseRow(r: CaseResult): string {
  const actual = r.message === null ? r.actual : `${r.actual}: ${esc(r.message)}`;
  return row([r.id, r.independent ? "independent" : "constructed", r.source, r.locked ? "yes" : "no", r.expected, actual, r.pass ? "yes" : "no"]);
}

/** The Markdown report. Deterministic: the same report gives the same text. */
export function renderReportMarkdown(report: EngineReport): string {
  return [
    "# Engine eval report",
    "",
    "Written by `npm run eval:engine` from the cases in `eval/engine/cases/`. Do not edit it by hand. What each number means: `docs/evals.md`.",
    "",
    `Engine: ${report.engine}.`,
    "",
    "Independent and constructed data are measured separately and never pooled. A rate with n = 0 is no data.",
    "",
    ...groupSection("Independent data", report.metrics.independent),
    ...groupSection("Constructed data", report.metrics.constructed),
    "## Cases",
    "",
    ...header(["Case", "Data", "Source", "Locked", "Expected", "Engine said", "Passes"]),
    ...report.cases.map(caseRow),
    "",
  ].join("\n");
}
