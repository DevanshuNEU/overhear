// npm run check:pinned: re-checks every pinned call offline and fails when an answer changed.
//
//   npm run check:pinned                      the pins in $OVERHEAR_HOME/pinned (default ~/.overhear/pinned)
//   npm run check:pinned -- --dir <folder>    an exported folder, such as pins kept in your repo (see docs/pinned.md)
//   npm run check:pinned -- --json            one JSON document instead of text (validated by CheckReportSchema)
//   npm run check:pinned -- --verbose         also print the engine's own message for a call it could not read
//
// Exit 0: every pin holds, or there are none. Exit 1: at least one pin changed. Exit 2: it could not run (a folder it does
// not trust, a missing --dir folder, a pin file it cannot use, two pins with one id, a bad option).
//
// It never reads the stored key, makes no network request and prints no call content. src/pinned/boundaries.test.ts checks
// the imports. The work is in src/pinned: the store reads the files, check.ts runs the engine, format.ts words the result.
import path from "node:path";
import { analyzeRetellCall } from "@/engine/analyze";
import type { Analyze } from "@/engine/types";
import { PrivateStoreError } from "@/local-store/private-dir";
import { checkPins, duplicateIds } from "@/pinned/check";
import { buildReport, formatJson, formatText, plain } from "@/pinned/format";
import { listPins, pinnedDir, PinStoreError, type PinListing } from "@/pinned/store";
import pkg from "../package.json";

/** What the command needs from its caller, so a test can run it without a process, a terminal or a real engine. */
export type Io = {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** The engine. The real one by default. */
  analyze?: Analyze;
  /** Reads the pins. By default the pin store: `dir` is the `--dir` folder, or undefined for the pinned folder. */
  load?: (dir: string | undefined) => Promise<PinListing>;
};

const USAGE = [
  "Usage: npm run check:pinned -- [--dir <folder>] [--json] [--verbose]",
  "",
  "  --dir <folder>  check an exported folder of pins, such as one kept in your repo",
  "  --json          print one JSON document instead of text",
  "  --verbose       also print the engine's own message for a call it could not read",
  "",
  "Exit 0: every pinned call holds. Exit 1: one changed. Exit 2: it could not run.",
].join("\n");

type Options = { dir: string | undefined; json: boolean; verbose: boolean; help: boolean };

/** The options, or what is wrong with them. Nothing a user typed is echoed back. */
function parseArgs(argv: readonly string[]): Options | { error: string } {
  const opts: Options = { dir: undefined, json: false, verbose: false, help: false };
  let dirGiven = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--verbose") opts.verbose = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--dir" || arg.startsWith("--dir=")) {
      const value = arg === "--dir" ? argv[++i] : arg.slice("--dir=".length);
      if (dirGiven) return { error: "Give --dir once." };
      if (value === undefined || value === "" || value.startsWith("--")) return { error: "--dir needs a folder: --dir <folder>." };
      opts.dir = value;
      dirGiven = true;
    } else return { error: "Unknown option. Use --dir <folder>, --json or --verbose." };
  }
  return opts;
}

const readFrom = (dir: string | undefined): Promise<PinListing> => listPins(dir === undefined ? {} : { dir, private: false });

/** Runs the command, writes through `io` and returns the exit code. Never throws. */
export async function main(argv: readonly string[], io: Io): Promise<number> {
  const opts = parseArgs(argv);
  if ("error" in opts) {
    io.stderr(`${opts.error}\n\n${USAGE}\n`);
    return 2;
  }
  if (opts.help) {
    io.stdout(`${USAGE}\n`);
    return 0;
  }
  // npm runs a script from the package folder, so a relative --dir means the folder npm was started in (INIT_CWD).
  const given = opts.dir === undefined ? undefined : path.resolve(process.env.INIT_CWD ?? process.cwd(), opts.dir);
  const dir = given ?? pinnedDir();
  try {
    const { pins, problems } = await (io.load ?? readFrom)(given);
    const dupes = duplicateIds(pins);
    if (dupes.length > 0) {
      io.stderr(`Two pinned calls share the id ${dupes.join(", ")}. Nothing was checked. Remove one of the files.\n`);
      return 2;
    }
    const results = checkPins(pins, io.analyze ?? analyzeRetellCall);
    const report = buildReport({ overhear: pkg.version, dir, pins: results, problems }, { verbose: opts.verbose });
    io.stdout(`${opts.json ? formatJson(report) : formatText(report)}\n`);
    if (report.problems.length > 0) return 2;
    return report.changed > 0 ? 1 : 0;
  } catch (err) {
    // A store error holds a fixed sentence and a path, and the path can be one the user typed, so it goes through the same
    // one-line sanitizer as the report: no escape sequence reaches a terminal. Anything else is named by its code only.
    if (err instanceof PinStoreError || err instanceof PrivateStoreError) io.stderr(`${plain(`Overhear could not check the pinned calls. ${err.message}`, 600)}\n`);
    else io.stderr(`Overhear could not check the pinned calls (${plain(String((err as NodeJS.ErrnoException).code ?? "unexpected error"), 40)}).\n`);
    return 2;
  }
}

// Run only when started as a script (tsx scripts/check-pinned.ts), not when a test imports main.
if (process.argv[1] !== undefined && /check-pinned\.[cm]?[jt]s$/.test(process.argv[1])) {
  main(process.argv.slice(2), {
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
  }).then((code) => {
    process.exitCode = code;
  });
}
