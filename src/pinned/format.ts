// How `npm run check:pinned` says what it found: a plain text report, or JSON that an exported schema validates.
// Pure: results in, a string out.
//
// Nothing here prints call content. What reaches the output is fixed words, ids and enum values, the pin's call id and
// its note (the pin schema bans control and invisible characters from a note and keeps ids to letters, digits, hyphens and
// underscores), the folder's path, and the store's fixed sentences about a file. The engine's own error message can quote
// a record, so it is left out of every report unless `--verbose` asks for it.
import { z } from "zod";
import { EXPERIENCE_EXPECTS } from "@/engine/eval/case";
import { VERDICT_LABEL } from "@/report/labels";
import { CONTRACT_IDS, EXPERIENCE_CHECKS, RESULTS, VERDICTS, type Verdict } from "@/report/schema";
import type { PinCheck } from "./check";
import type { PinProblem } from "./store";

const ActualVerdictSchema = z.enum([...VERDICTS, "no_content", "error"]);
const ActualResultSchema = z.enum([...RESULTS, "missing", "no_report"]);
const ActualExperienceSchema = z.enum([...EXPERIENCE_EXPECTS, "not_run", "no_report"]);

const PinResultSchema = z.strictObject({
  id: z.string(),
  callId: z.string(),
  pinnedAt: z.string(),
  pinnedWith: z.string(),
  note: z.string().nullable(),
  status: z.enum(["held", "changed"]),
  expected: z.strictObject({
    verdict: z.enum(VERDICTS),
    contracts: z.partialRecord(z.enum(CONTRACT_IDS), z.enum(RESULTS)),
    experience: z.partialRecord(z.enum(EXPERIENCE_CHECKS), z.enum(EXPERIENCE_EXPECTS)),
  }),
  actual: z.strictObject({
    verdict: ActualVerdictSchema,
    contracts: z.partialRecord(z.enum(CONTRACT_IDS), ActualResultSchema),
    experience: z.partialRecord(z.enum(EXPERIENCE_CHECKS), ActualExperienceSchema),
  }),
  changes: z.array(z.strictObject({ what: z.enum(["verdict", "contract", "experience", "citation"]), name: z.string(), was: z.string(), now: z.string() })),
  /** The engine's message for an error outcome. Present only with `--verbose`. */
  message: z.string().optional(),
});

/** The `--json` output of `npm run check:pinned`. Exported so a CI step or a test can validate it. */
export const CheckReportSchema = z.strictObject({
  schemaVersion: z.literal(1),
  overhear: z.string(),
  dir: z.string(),
  checked: z.number().int().nonnegative(),
  held: z.number().int().nonnegative(),
  changed: z.number().int().nonnegative(),
  pins: z.array(PinResultSchema),
  problems: z.array(z.strictObject({ file: z.string(), message: z.string() })),
});

export type CheckReport = z.infer<typeof CheckReportSchema>;

/** The report for a run: the counts, each pin, and the files that could not be used. Engine messages only when verbose. */
export function buildReport(
  run: { overhear: string; dir: string; pins: readonly PinCheck[]; problems: readonly PinProblem[] },
  options: { verbose: boolean },
): CheckReport {
  const held = run.pins.filter((p) => p.status === "held").length;
  return {
    schemaVersion: 1,
    overhear: run.overhear,
    dir: run.dir,
    checked: run.pins.length,
    held,
    changed: run.pins.length - held,
    pins: run.pins.map(({ message, ...pin }) => (options.verbose && message !== null ? { ...pin, message } : pin)),
    problems: run.problems.map((p) => ({ file: p.file, message: p.message })),
  };
}

/** The report as JSON text, one key per line. */
export const formatJson = (report: CheckReport): string => JSON.stringify(report, null, 2);

/** One line: a line break or tab becomes a space, any other control or line separator character becomes "?", and a long text is cut. */
export function plain(text: string, max = 300): string {
  const flat = text.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, (c) => (c === "\n" || c === "\r" || c === "\t" ? " " : "?"));
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

/** What a kept verdict read as, or why it read as none. */
function verdictWords(verdict: string): string {
  if (verdict === "no_content") return "no report (no content)";
  if (verdict === "error") return "no report (engine error)";
  return VERDICT_LABEL[verdict as Verdict] ?? plain(verdict, 40);
}

const words = (value: string): string => plain(value.replace(/_/g, " "), 40);

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The text report: the count, then each changed pin with what changed. Held pins are in `--json`. */
export function formatText(report: CheckReport): string {
  if (report.checked === 0 && report.problems.length === 0) return `No pinned calls in ${plain(report.dir)}.`;
  const lines = [`Overhear checked ${plural(report.checked, "pinned call", "pinned calls")}: ${report.held} held, ${report.changed} changed.`];
  for (const pin of report.pins.filter((p) => p.status === "changed")) {
    lines.push("", `changed  ${pin.id}  pinned ${plain(pin.pinnedAt.slice(0, 10), 10)} with ${plain(pin.pinnedWith, 64)}`);
    for (const c of pin.changes) {
      const now = c.what === "verdict" ? verdictWords(c.now) : words(c.now);
      const was = c.what === "verdict" ? verdictWords(c.was) : words(c.was);
      lines.push(`         ${c.name}: was ${was}, now ${now}`);
    }
    if (pin.note !== null) lines.push(`         note: ${plain(pin.note, 280)}`);
    if (pin.message !== undefined) lines.push(`         engine: ${plain(pin.message)}`);
  }
  if (report.problems.length > 0) {
    lines.push("", `Could not use ${plural(report.problems.length, "file", "files")}:`);
    for (const p of report.problems) lines.push(`  ${plain(p.message)}`);
  }
  lines.push("", "Run with --json for every result.");
  return lines.join("\n");
}
