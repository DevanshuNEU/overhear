// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeRetellCall } from "@/engine/analyze";
import { formatCase, parseCase, type EvalCase } from "@/engine/eval/case";
import type { Analyze } from "@/engine/types";
import { CheckReportSchema } from "@/pinned/format";
import { pinIdFor } from "@/pinned/pin-id";
import { savePin } from "@/pinned/store";
import { failedPin, marked, passedPin, pinOf, recordOf } from "@/pinned/testing";
import { failedSample, passedSample } from "@/report/samples";
import { main, type Io } from "./check-pinned";

// The check reads no key and reaches no network. A call to any of these fails the test that made it.
const mocks = vi.hoisted(() => ({ keyRead: vi.fn(), request: vi.fn(), fetch: vi.fn() }));
vi.mock("@/pull/key-store", async (original) => ({
  ...(await original<typeof import("@/pull/key-store")>()),
  readKey: () => {
    mocks.keyRead();
    throw new Error("the key was read");
  },
  hasKey: () => {
    mocks.keyRead();
    throw new Error("the key was read");
  },
}));
vi.mock("node:http", () => ({ default: { request: mocks.request, get: mocks.request }, request: mocks.request, get: mocks.request }));
vi.mock("node:https", () => ({ default: { request: mocks.request, get: mocks.request }, request: mocks.request, get: mocks.request }));

const MARKER = "CANARY-PHI-91b2";

let root: string;
let home: string;
let out: string[];
let err: string[];

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "overhear-check-pinned-")));
  home = path.join(root, "home");
  vi.stubEnv("OVERHEAR_HOME", home);
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockImplementation(() => {
    throw new Error("network request");
  });
  mocks.request.mockImplementation(() => {
    throw new Error("network request");
  });
  out = [];
  err = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

const io = (extra: Partial<Io> = {}): Io => ({ stdout: (t) => out.push(t), stderr: (t) => err.push(t), ...extra });
const run = async (args: string[], extra: Partial<Io> = {}) => {
  out = [];
  err = [];
  const code = await main(args, io(extra));
  return { code, stdout: out.join(""), stderr: err.join("") };
};
const dirOf = () => path.join(home, "pinned");

/** An exported folder: 0644 files in a 0755 folder, as a checkout writes them. */
function exportTo(pins: EvalCase[], name = "overhear-pins"): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  fs.chmodSync(dir, 0o755);
  for (const pin of pins) fs.writeFileSync(path.join(dir, `${pin.id}.json`), formatCase(pin), { mode: 0o644 });
  return dir;
}

/** A pin whose expectation was edited, and is still a valid pin. */
const expecting = (pin: EvalCase, patch: Record<string, unknown>): EvalCase => parseCase({ ...pin, expect: { ...pin.expect, ...patch } });
/** The failed pin with transfer_kept ticked as unverified: it reads violated now, so it has changed. */
const changedPin = (): EvalCase => {
  const pin = failedPin("call_8f2a9c", "nurse transfer promised, never made");
  return expecting(pin, { contracts: { ...pin.expect.contracts, transfer_kept: "unverified" } });
};

describe("exit codes", () => {
  it("0 when every pin holds, and says how many", async () => {
    await savePin(failedPin());
    await savePin(passedPin());
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("Overhear checked 2 pinned calls: 2 held, 0 changed.\n\nRun with --json for every result.\n");
    expect(r.stderr).toBe("");
  });

  it("0 with no pinned folder at all, and writes nothing", async () => {
    const r = await run([]);
    expect(r).toEqual({ code: 0, stdout: `No pinned calls in ${dirOf()}.\n`, stderr: "" });
    expect(fs.existsSync(home)).toBe(false);
  });

  it("0 for an empty pinned folder", async () => {
    await savePin(failedPin());
    fs.rmSync(path.join(dirOf(), `${failedPin().id}.json`));
    expect((await run([])).stdout).toBe(`No pinned calls in ${dirOf()}.\n`);
  });

  it("1 when a kept contract changed, with the exact text", async () => {
    await savePin(changedPin());
    await savePin(passedPin());
    const r = await run([]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe(
      [
        "Overhear checked 2 pinned calls: 1 held, 1 changed.",
        "",
        `changed  ${pinIdFor("call_8f2a9c")}  pinned 2026-11-08 with 0.1.0`,
        "         transfer_kept: was unverified, now violated",
        "         note: nurse transfer promised, never made",
        "",
        "Run with --json for every result.",
        "",
      ].join("\n"),
    );
  });

  it("1 when only the verdict changed, when only an experience check changed, and when there is no report", async () => {
    const failed = failedPin();
    const verdictOnly = expecting(failed, { verdict: "needs_review", contracts: {}, experience: {} });
    const passed = passedPin();
    const experienceOnly = expecting(passed, { experience: { ...passed.expect.experience, spoken_format: "clean" } });
    for (const pin of [verdictOnly, experienceOnly]) {
      const dir = exportTo([pin], `one-${pin.id}`);
      const r = await run(["--dir", dir]);
      expect(r.code).toBe(1);
      expect(r.stdout).toContain(`changed  ${pin.id}`);
    }
    const noReport: Analyze = (raw) => ({ kind: "no_content", callId: (raw as { call_id: string }).call_id, reason: "no_transcript" });
    const r = await run(["--dir", exportTo([failed])], { analyze: noReport });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("verdict: was Failed, now no report (no content)");
  });

  it("2 for a folder open to other users, a missing --dir folder, and --dir with no value", async () => {
    fs.mkdirSync(home, { mode: 0o700 });
    fs.mkdirSync(dirOf(), { mode: 0o755 });
    fs.chmodSync(dirOf(), 0o755);
    const open = await run([]);
    expect(open.code).toBe(2);
    expect(open.stdout).toBe("");
    expect(open.stderr).toContain("open to other users");

    const missing = await run(["--dir", path.join(root, "nowhere")]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("does not exist");

    const none = await run(["--dir"]);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("--dir needs a folder");
  });

  it("2 for a symlinked --dir folder, and for an unknown option", async () => {
    const real = exportTo([failedPin()]);
    const link = path.join(root, "link");
    fs.symlinkSync(real, link);
    expect((await run(["--dir", link])).code).toBe(2);
    const bad = await run(["--nope"]);
    expect(bad.code).toBe(2);
    expect(bad.stderr).toContain("Unknown option");
  });

  it("2 when a pin file cannot be used, naming the file and never what it held, and still checks the rest", async () => {
    const dir = exportTo([failedPin()]);
    fs.writeFileSync(path.join(dir, "pin-broken-12345678.json"), `{"not json ${MARKER}`);
    const r = await run(["--dir", dir]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("pin-broken-12345678.json is not valid JSON.");
    expect(r.stdout).toContain("Overhear checked 1 pinned call: 1 held, 0 changed.");
    expect(r.stdout + r.stderr).not.toContain(MARKER);
  });

  it("2 for a duplicate id, checking nothing", async () => {
    const pin = failedPin();
    const analyze = vi.fn(analyzeRetellCall);
    const r = await run([], {
      analyze,
      load: async () => ({
        pins: [
          { id: pin.id, pin },
          { id: pin.id, pin },
        ],
        problems: [],
      }),
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(pin.id);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("an unusable file (2) wins over a changed pin (1)", async () => {
    const dir = exportTo([changedPin()]);
    expect((await run(["--dir", dir])).code).toBe(1);
    fs.writeFileSync(path.join(dir, "pin-broken-12345678.json"), "{");
    expect((await run(["--dir", dir])).code).toBe(2);
  });
});

describe("--dir", () => {
  it("reads 0644 files in a 0755 folder inside a repo checkout, and never touches OVERHEAR_HOME", async () => {
    fs.mkdirSync(path.join(root, ".git"));
    const dir = exportTo([failedPin(), passedPin()]);
    const r = await run(["--dir", dir]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("2 held");
    expect((await run([`--dir=${dir}`])).code).toBe(0);
    expect(fs.existsSync(home)).toBe(false);
  });

  it("still refuses a symlink or a folder planted at a pin's name, and a file over 5 MB, as problems", async () => {
    const dir = exportTo([failedPin()]);
    fs.symlinkSync(path.join(dir, `${failedPin().id}.json`), path.join(dir, "pin-link-12345678.json"));
    const r = await run(["--dir", dir]);
    expect(r.code).toBe(2);
    expect(r.stdout).toContain("pin-link-12345678.json is not a plain file, so it was not read.");
  });

  it("checks every pin in the zone it was pinned in", async () => {
    const seen: string[] = [];
    const analyze: Analyze = (raw, opts) => {
      seen.push(opts.tz);
      return analyzeRetellCall(raw, opts);
    };
    await run(["--dir", exportTo([failedPin()])], { analyze });
    expect(seen).toEqual(["America/New_York"]);
  });
});

describe("--json", () => {
  it("prints one document that the exported schema validates, and still exits 1 for a change", async () => {
    await savePin(changedPin());
    await savePin(passedPin());
    const r = await run(["--json"]);
    expect(r.code).toBe(1);
    const report = CheckReportSchema.parse(JSON.parse(r.stdout));
    expect(report).toMatchObject({ schemaVersion: 1, overhear: "0.1.0", dir: dirOf(), checked: 2, held: 1, changed: 1, problems: [] });
    const changed = report.pins.find((p) => p.status === "changed");
    expect(changed).toMatchObject({
      id: pinIdFor("call_8f2a9c"),
      callId: "call_8f2a9c",
      note: "nurse transfer promised, never made",
      changes: [{ what: "contract", name: "transfer_kept", was: "unverified", now: "violated" }],
    });
    expect(changed?.expected.contracts.transfer_kept).toBe("unverified");
    expect(changed?.actual.contracts.transfer_kept).toBe("violated");
  });

  it("holds for an empty folder, and carries the problems", async () => {
    const empty = await run(["--json", "--dir", exportTo([], "empty")]);
    expect(empty.code).toBe(0);
    expect(CheckReportSchema.parse(JSON.parse(empty.stdout))).toMatchObject({ checked: 0, held: 0, changed: 0, pins: [] });
    const dir = exportTo([failedPin()]);
    fs.writeFileSync(path.join(dir, "pin-broken-12345678.json"), "{");
    const bad = await run(["--json", "--dir", dir]);
    expect(bad.code).toBe(2);
    expect(CheckReportSchema.parse(JSON.parse(bad.stdout)).problems).toEqual([
      { file: "pin-broken-12345678.json", message: "pin-broken-12345678.json is not valid JSON." },
    ]);
  });
});

describe("what the output never holds", () => {
  const throwing: Analyze = () => {
    throw new Error(`the record said ${MARKER}`);
  };

  /** Pins whose every string, bar the ids the output shows on purpose, carries the marker. */
  const dirtyPins = (): EvalCase[] => [
    pinOf(marked(recordOf(failedSample, "call_dirty_1"), MARKER) as Record<string, unknown>),
    pinOf(marked(recordOf(passedSample, "call_dirty_2"), MARKER) as Record<string, unknown>),
  ];

  it("a marker in every string of a pinned record never reaches stdout, stderr or the JSON, held or changed", async () => {
    const [a, b] = dirtyPins();
    const changedDirty = expecting(a, { verdict: "needs_review", contracts: {}, experience: {} });
    for (const pins of [[a, b], [changedDirty, b]]) {
      const dir = exportTo(pins, `dirty-${pins[0].id}`);
      for (const args of [[], ["--json"]]) {
        const r = await run(["--dir", dir, ...args]);
        expect(r.stdout + r.stderr).not.toContain(MARKER);
      }
    }
  });

  it("the canary is real: the marker is in the records the check read", () => {
    const [a] = dirtyPins();
    expect(JSON.stringify(a.record)).toContain(MARKER);
    expect(JSON.stringify(a.record.transcript_with_tool_calls).split(MARKER).length).toBeGreaterThan(5);
  });

  it("a record that makes the engine throw puts its message in no output unless --verbose asks", async () => {
    const dir = exportTo(dirtyPins());
    for (const args of [[], ["--json"]]) {
      const r = await run(["--dir", dir, ...args], { analyze: throwing });
      expect(r.code).toBe(1);
      expect(r.stdout + r.stderr).not.toContain(MARKER);
      expect(r.stdout + r.stderr).not.toContain("the engine threw");
    }
    const loud = await run(["--dir", dir, "--verbose"], { analyze: throwing });
    expect(loud.stdout).toContain(`the engine threw: the record said ${MARKER}`);
    const json = await run(["--dir", dir, "--json", "--verbose"], { analyze: throwing });
    expect(CheckReportSchema.parse(JSON.parse(json.stdout)).pins[0].message).toContain(MARKER);
  });

  it("a pin file that is not a valid pin names its file and the schema paths, never a value", async () => {
    const dir = exportTo([]);
    const raw = JSON.parse(formatCase(failedPin()));
    raw.record.call_id = MARKER;
    raw.expect.verdict = MARKER;
    raw.label.by = MARKER;
    fs.writeFileSync(path.join(dir, "pin-bad-12345678.json"), JSON.stringify(raw));
    const r = await run(["--dir", dir]);
    expect(r.code).toBe(2);
    expect(r.stdout + r.stderr).not.toContain(MARKER);
  });

  it("a folder or file name with escape characters prints without them", async () => {
    const dir = exportTo([]);
    fs.writeFileSync(path.join(dir, "pin-\u001b[31mred.json"), "{");
    const r = await run(["--dir", dir]);
    expect(r.stdout).not.toContain("\u001b");
    expect(r.stdout).toContain("pin-?[31mred.json");
  });
});

describe("what the check never does", () => {
  it("reads no key and makes no network request, over held, changed and unusable pins", async () => {
    await savePin(changedPin());
    await savePin(passedPin());
    const dir = exportTo([failedPin()]);
    fs.writeFileSync(path.join(dir, "pin-broken-12345678.json"), "{");
    for (const args of [[], ["--json"], ["--dir", dir], ["--dir", dir, "--verbose"], ["--help"]]) await run(args);
    expect(mocks.keyRead).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("the stubs would stop a request: fetch throws, and so does http", async () => {
    expect(() => fetch("https://example.com")).toThrow("network request");
    const https = await import("node:https");
    expect(() => https.request("https://example.com")).toThrow("network request");
  });

  it("changes no file in the folder it reads", async () => {
    const dir = exportTo([changedPin(), passedPin()]);
    const before = fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8"), fs.statSync(path.join(dir, f)).mode]);
    await run(["--dir", dir]);
    expect(fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8"), fs.statSync(path.join(dir, f)).mode])).toEqual(before);
  });
});

describe("--help", () => {
  it("says how to use it and exits 0", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("npm run check:pinned");
    expect(r.stdout).toContain("--dir <folder>");
  });
});
