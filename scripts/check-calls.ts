// npm run check -- <files or folders>: checks call record files from the terminal, for CI. Each file is one raw call
// (a Retell get-call body, or the JSON of a LiveKit SessionReport.to_dict()), read by the same engine as the app.
//
//   npm run check -- calls/                      every .json file in the folder (not its subfolders)
//   npm run check -- a.json b.json --tz America/New_York
//   npm run check -- calls/ --color off
//
// Exit 0: no call failed. Exit 1: at least one failed. Exit 2: it could not run (no paths, a file it cannot read, a bad option).
// It makes no network request and reads no stored key.
import fs from "node:fs";
import path from "node:path";
import { analyzeRecord } from "@/engine/analyze";
import { LIST_WORDS } from "@/app/callListWords";
import { rowFor } from "@/pull/pull";
import { NO_CONTENT_LINE, VERDICT_LABEL } from "@/report/labels";
import type { Outcome } from "@/engine/types";

/** One file's outcome, with the file's name so two calls that share an id can be told apart. */
export type CheckedCall = { file: string; outcome: Outcome };

/** Passing calls are listed one by one only up to this many; more than this collapse to a count in the summary. */
export const PASSED_LIST_MAX = 10;

type Status = "Failed" | "Needs review" | "Passed" | "Nothing done" | "No content" | "Error";
const STATUS_WIDTH = "Needs review".length;

const USAGE = [
  "Examples:",
  "  npm run check -- calls/                          check every .json file in a folder",
  "  npm run check -- call.json other.json            check two files",
  "  npm run check -- calls/ --tz America/New_York    read spoken times in another time zone",
  "  npm run check -- calls/ --color off              plain text, for a CI log",
  "",
  "Usage: npm run check -- <file or folder>... [--tz <zone>] [--color auto|on|off]",
  "",
  "Each file is one call: a Retell get-call body, or the JSON of a LiveKit SessionReport.to_dict().",
  "",
  "  --tz <zone>      IANA time zone for spoken times (default: this computer's zone)",
  "  --color <mode>   auto (default: on in a terminal), on or off. NO_COLOR also turns it off.",
  "",
  "Exit 0: no call failed. Exit 1: a call failed. Exit 2: it could not run.",
].join("\n");

// Three colors only: red for Failed, amber for Needs review, the terminal's default for the rest.
const style = (on: boolean) => ({
  bold: (s: string) => (on ? `\x1b[1m${s}\x1b[22m` : s),
  faint: (s: string) => (on ? `\x1b[2m${s}\x1b[22m` : s),
  red: (s: string) => (on ? `\x1b[31m${s}\x1b[39m` : s),
  amber: (s: string) => (on ? `\x1b[33m${s}\x1b[39m` : s),
});

/** Text from a file goes to a terminal, so control characters (an escape sequence included) are dropped and the length capped. */
const plain = (text: string, max = 300): string => {
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

function statusOf(o: Outcome): Status {
  if (o.kind === "error") return "Error";
  if (o.kind === "no_content") return "No content";
  return VERDICT_LABEL[o.report.verdict] as Status;
}

/**
 * The words after the call id. For a report, the sentence the call list shows for that call (rowFor's lead, and
 * CallRow's wording for a passed or nothing-done call). Otherwise the reason there is no content, or what went wrong.
 */
function headlineOf(o: Outcome): string {
  if (o.kind === "error") return o.message;
  if (o.kind === "no_content") return NO_CONTENT_LINE[o.reason];
  const row = rowFor({ callId: o.report.callId, startedAt: 0, durationMs: null, callStatus: "ended", agentId: null, dataStorageSetting: null }, o);
  if (row.verdict === "passed") return row.notes?.includes("no_promises_made") ? LIST_WORDS.noPromises : LIST_WORDS.everyPromiseKept;
  const text = row.lead ?? row.headline ?? "";
  return row.verdict === "nothing_done" ? text.replace(/^Nothing done\.\s*/, "") : text;
}

/** The lines under a failed call: what each violated finding says. */
function violations(o: Outcome): string[] {
  if (o.kind !== "report") return [];
  return o.report.results.flatMap((r) => r.findings.filter((f) => f.result === "violated").map((f) => f.text));
}

/** The summary line: "3 of 12 calls failed. 2 need review." or "No calls failed." and what else needs a look. */
export function summaryLine(calls: readonly CheckedCall[]): string {
  const count = (s: Status) => calls.filter((c) => statusOf(c.outcome) === s).length;
  const failed = count("Failed");
  const review = count("Needs review");
  const errors = count("Error");
  const parts = [failed === 0 ? "No calls failed." : `${failed} of ${calls.length} ${calls.length === 1 ? "call" : "calls"} failed.`];
  if (review > 0) parts.push(review === 1 ? "1 needs review." : `${review} need review.`);
  if (errors > 0) parts.push(errors === 1 ? "1 could not be read." : `${errors} could not be read.`);
  const passed = count("Passed");
  if (passed > PASSED_LIST_MAX) parts.push(`${passed} passed.`);
  return parts.join(" ");
}

/** The whole output for a set of checked calls: one line per call, a failed call's reasons under it, then the summary. */
export function formatCalls(calls: readonly CheckedCall[], opts: { color: boolean }): string {
  const s = style(opts.color);
  const collapse = calls.filter((c) => statusOf(c.outcome) === "Passed").length > PASSED_LIST_MAX;
  const lines: string[] = [];
  for (const { file, outcome } of calls) {
    const status = statusOf(outcome);
    if (collapse && status === "Passed") continue;
    const word = s.bold(status.padEnd(STATUS_WIDTH));
    const colored = status === "Failed" ? s.red(word) : status === "Needs review" ? s.amber(word) : word;
    const id = outcome.kind === "error" ? (outcome.callId ?? "-") : outcome.kind === "no_content" ? outcome.callId : outcome.report.callId;
    lines.push(`${colored}  ${s.bold(plain(id, 80))}  ${plain(headlineOf(outcome))}  ${s.faint(plain(path.basename(file), 80))}`);
    if (status === "Failed") for (const text of violations(outcome)) lines.push(`${" ".repeat(STATUS_WIDTH + 2)}${s.red("-")} ${plain(text, 400)}`);
  }
  if (lines.length > 0) lines.push("");
  lines.push(summaryLine(calls));
  return lines.join("\n");
}

/** What the command needs from its caller, so a test can run it without a process or a terminal. */
export type Io = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  isTTY: boolean;
  env: Record<string, string | undefined>;
  /** The folder relative paths mean: where npm was started. */
  cwd: string;
  /** The machine's time zone. */
  zone: string;
};

type Options = { paths: string[]; tz: string | undefined; color: "auto" | "on" | "off"; help: boolean };

function parseArgs(argv: readonly string[]): Options | { error: string } {
  const opts: Options = { paths: [], tz: undefined, color: "auto", help: false };
  const value = (i: number, name: string): string | { error: string } => {
    const v = argv[i + 1];
    return v === undefined || v.startsWith("--") ? { error: `${name} needs a value. Example: ${name} ${name === "--tz" ? "America/New_York" : "off"}.` } : v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--tz" || arg === "--color") {
      const v = value(i, arg);
      if (typeof v !== "string") return v;
      i++;
      if (arg === "--tz") opts.tz = v;
      else if (v === "auto" || v === "on" || v === "off") opts.color = v;
      else return { error: "--color takes auto, on or off. Example: --color off." };
    } else if (arg.startsWith("--tz=")) opts.tz = arg.slice(5);
    else if (arg.startsWith("--color=")) {
      const v = arg.slice(8);
      if (v !== "auto" && v !== "on" && v !== "off") return { error: "--color takes auto, on or off. Example: --color off." };
      opts.color = v;
    } else if (arg.startsWith("--")) return { error: `Unknown option ${plain(arg, 40)}. Use --tz, --color or --help.` };
    else opts.paths.push(arg);
  }
  return opts;
}

const isZone = (zone: string): boolean => {
  if (zone === "" || /^[+-]/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

/** The .json files an argument names: the file itself, or the .json files directly in a folder, in name order. */
function expand(arg: string, cwd: string): { files: string[] } | { error: string } {
  const full = path.resolve(cwd, arg);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(full);
  } catch (err) {
    const why = (err as NodeJS.ErrnoException).code === "ENOENT" ? "it does not exist" : `it could not be read (${(err as NodeJS.ErrnoException).code ?? "unknown error"})`;
    return { error: `Could not read ${plain(arg, 200)}: ${why}. Check the path and run the command again.` };
  }
  if (stat.isDirectory()) {
    const files = fs
      .readdirSync(full)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => path.join(full, f));
    if (files.length === 0) return { error: `Found no .json files in ${plain(arg, 200)}. Pass a folder that holds call files, or name a file.` };
    return { files };
  }
  return { files: [full] };
}

/** Runs the command, writes through `io` and returns the exit code. Never throws. */
export function main(argv: readonly string[], io: Io): number {
  const opts = parseArgs(argv);
  if ("error" in opts) {
    io.stderr(`${opts.error}\n\n${USAGE}\n`);
    return 2;
  }
  if (opts.help) {
    io.stdout(`${USAGE}\n`);
    return 0;
  }
  if (opts.paths.length === 0) {
    io.stderr(`No files given. Pass a call file or a folder of them.\n\n${USAGE}\n`);
    return 2;
  }
  const tz = opts.tz ?? io.zone;
  if (!isZone(tz)) {
    io.stderr(`${plain(tz, 60)} is not a time zone. Use an IANA name such as America/New_York or UTC, for example --tz UTC.\n`);
    return 2;
  }

  // Read everything first: one file that cannot be read stops the run, so a CI job never passes on a partial check.
  const files: string[] = [];
  const problems: string[] = [];
  for (const arg of opts.paths) {
    const found = expand(arg, io.cwd);
    if ("error" in found) problems.push(found.error);
    else files.push(...found.files);
  }
  const records: { file: string; raw: unknown }[] = [];
  for (const file of files) {
    try {
      records.push({ file, raw: JSON.parse(fs.readFileSync(file, "utf8")) });
    } catch (err) {
      const why = err instanceof SyntaxError ? "it is not valid JSON" : `it could not be read (${(err as NodeJS.ErrnoException).code ?? "unknown error"})`;
      problems.push(`Could not read ${plain(path.relative(io.cwd, file) || file, 200)}: ${why}. Fix the file or remove it from the command, then run it again.`);
    }
  }
  if (problems.length > 0) {
    io.stderr(`${problems.join("\n")}\n`);
    return 2;
  }

  const calls: CheckedCall[] = records.map(({ file, raw }) => ({ file, outcome: analyzeRecord(raw, { tz }) }));
  const color = opts.color === "on" || (opts.color === "auto" && io.isTTY && (io.env.NO_COLOR === undefined || io.env.NO_COLOR === ""));
  io.stdout(`${formatCalls(calls, { color })}\n`);
  return calls.some((c) => c.outcome.kind === "report" && c.outcome.report.verdict === "failed") ? 1 : 0;
}

// Run only when started as a script (tsx scripts/check-calls.ts), not when a test imports main.
if (process.argv[1] !== undefined && /check-calls\.[cm]?[jt]s$/.test(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2), {
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
    isTTY: process.stdout.isTTY === true,
    env: process.env,
    cwd: process.env.INIT_CWD ?? process.cwd(),
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}
