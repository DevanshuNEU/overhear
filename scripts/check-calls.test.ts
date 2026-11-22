// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeRecord } from "@/engine/analyze";
import { toRetell } from "@/engine/testing/retell";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { PASSED_LIST_MAX, formatCalls, main, summaryLine, type CheckedCall, type Io } from "./check-calls";

const opts = { tz: "UTC" };
const call = (file: string, raw: unknown): CheckedCall => ({ file, outcome: analyzeRecord(raw, opts) });
const failed = () => call("failed.json", toRetell(failedSample.evidence));
const review = () => call("review.json", toRetell(needsReviewSample.evidence));
const passed = (i = 0) => call(`passed-${i}.json`, { ...(toRetell(passedSample.evidence) as Record<string, unknown>), call_id: `call_pass_${i}` });
const empty = () => call("empty.json", { call_id: "call_empty" });
const broken = () => call("broken.json", { nothing: true });

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const ESC = "\x1b";

describe("formatCalls", () => {
  it("prints one aligned line per call: status, call id, headline, then the file", () => {
    const text = stripAnsi(formatCalls([failed(), review(), passed(), empty(), broken()], { color: false }));
    const lines = text.split("\n");
    expect(lines[0]).toMatch(/^Failed {8}\S+ {2}The call broke a rule/);
    const starts = lines.filter((l) => /^(Failed|Needs review|Passed|Nothing done|No content|Error)/.test(l));
    expect(starts).toHaveLength(5);
    // The id column starts at the same place on every line.
    const col = starts.map((l) => l.search(/ {2}\S/) + 2);
    expect(new Set(col).size).toBe(1);
    expect(text).toContain("No content");
    expect(text).toContain("Retell returned no transcript");
    expect(text).toMatch(/Error {9}/);
  });

  it("expands a failed call with each violated finding's text, and no other call", () => {
    const f = failed();
    const violated = f.outcome.kind === "report" ? f.outcome.report.results.flatMap((r) => r.findings.filter((x) => x.result === "violated")) : [];
    expect(violated.length).toBeGreaterThan(0);
    const lines = stripAnsi(formatCalls([f, review()], { color: false })).split("\n");
    const under = lines.slice(1, 1 + violated.length);
    violated.forEach((v, i) => expect(under[i]).toBe(`${" ".repeat(14)}- ${v.text}`));
    expect(lines.filter((l) => l.startsWith(" "))).toHaveLength(violated.length);
  });

  it("colors only Failed red and Needs review amber, with bold names and faint files", () => {
    const text = formatCalls([failed(), review(), passed()], { color: true });
    const [f, r, p] = text.split("\n").filter((l) => /^\x1b\[(31|33|1)m/.test(l));
    expect(f).toContain(`${ESC}[31m`);
    expect(r).toContain(`${ESC}[33m`);
    expect(p).not.toMatch(/\x1b\[3[0-9]m/);
    expect(f).toContain(`${ESC}[2m`);
    // Only red, amber and the default are used for color.
    expect([...text.matchAll(/\x1b\[(3\d|9\d|4\d)m/g)].every((m) => m[1] === "31" || m[1] === "33" || m[1] === "39")).toBe(true);
  });

  it("writes no escape sequence with color off", () => {
    expect(formatCalls([failed(), review(), passed()], { color: false })).not.toContain(ESC);
  });

  it("collapses passing calls to a count when there are more than 10", () => {
    const some = Array.from({ length: PASSED_LIST_MAX }, (_, i) => passed(i));
    expect(formatCalls(some, { color: false })).toContain("Passed");
    const many = [failed(), ...Array.from({ length: PASSED_LIST_MAX + 1 }, (_, i) => passed(i))];
    const text = formatCalls(many, { color: false });
    expect(text).not.toMatch(/^Passed/m);
    expect(text).toContain("1 of 12 calls failed. 11 passed.");
  });

  it("strips control characters a file could put into a headline or id", () => {
    const hostile = call("x\u001b[31m.json", { job_id: "AJ\u001b]0;pwn\u0007", chat_history: { items: [{ type: "message", role: "user", content: ["hi"], created_at: 1 }, { type: "message", role: "assistant", content: ["x"], created_at: 2 }] } });
    expect(formatCalls([hostile], { color: false })).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/);
  });
});

describe("summaryLine", () => {
  it("counts failed calls and those that need review", () => {
    expect(summaryLine([failed(), review(), review(), passed(), passed(1), passed(2)])).toBe("1 of 6 calls failed. 2 need review.");
    expect(summaryLine([failed(), review()])).toBe("1 of 2 calls failed. 1 needs review.");
  });

  it("says no calls failed, and still names what needs a look", () => {
    expect(summaryLine([passed(), passed(1)])).toBe("No calls failed.");
    expect(summaryLine([review(), broken()])).toBe("No calls failed. 1 needs review. 1 could not be read.");
  });
});

describe("main", () => {
  let dir: string;
  let out: string;
  let err: string;
  const io = (over: Partial<Io> = {}): Io => ({
    stdout: (t) => void (out += t),
    stderr: (t) => void (err += t),
    isTTY: true,
    env: {},
    cwd: dir,
    zone: "UTC",
    ...over,
  });
  const write = (name: string, body: unknown) => fs.writeFileSync(path.join(dir, name), typeof body === "string" ? body : JSON.stringify(body));

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "overhear-check-calls-")));
    out = "";
    err = "";
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("exits 0 when no call failed", () => {
    write("pass.json", toRetell(passedSample.evidence));
    expect(main(["pass.json"], io())).toBe(0);
    expect(stripAnsi(out)).toContain("No calls failed.");
  });

  it("exits 1 when a call failed, reading a folder's .json files and not its subfolders", () => {
    write("a-pass.json", toRetell(passedSample.evidence));
    write("b-fail.json", toRetell(failedSample.evidence));
    write("notes.txt", "ignored");
    fs.mkdirSync(path.join(dir, "sub"));
    fs.writeFileSync(path.join(dir, "sub", "c.json"), "not json");
    expect(main(["."], io())).toBe(1);
    expect(stripAnsi(out)).toContain("1 of 2 calls failed.");
  });

  it("exits 2 with no paths, and prints the examples", () => {
    expect(main([], io())).toBe(2);
    expect(err).toContain("Examples:");
  });

  it("exits 2 for a missing file, naming it and the fix", () => {
    expect(main(["nope.json"], io())).toBe(2);
    expect(err).toContain("nope.json");
    expect(err).toContain("does not exist");
    expect(err).toContain("Check the path");
    expect(out).toBe("");
  });

  it("exits 2 for a file that is not JSON, naming it and the fix, and checks nothing", () => {
    write("pass.json", toRetell(passedSample.evidence));
    write("bad.json", "{oops");
    expect(main(["pass.json", "bad.json"], io())).toBe(2);
    expect(err).toContain("bad.json");
    expect(err).toContain("not valid JSON");
    expect(err).toContain("Fix the file or remove it");
    expect(out).toBe("");
  });

  it("exits 2 for an empty folder, a bad time zone and an unknown option", () => {
    expect(main(["."], io())).toBe(2);
    expect(err).toContain("no .json files");
    write("pass.json", toRetell(passedSample.evidence));
    err = "";
    expect(main(["pass.json", "--tz", "Mars/Base"], io())).toBe(2);
    expect(err).toContain("not a time zone");
    err = "";
    expect(main(["pass.json", "--wat"], io())).toBe(2);
    expect(err).toContain("Unknown option");
  });

  it("an unreadable call is an Error line and does not fail the run", () => {
    write("odd.json", { nothing: true });
    expect(main(["odd.json"], io())).toBe(0);
    expect(stripAnsi(out)).toContain("Error");
  });

  it("prints --help with the examples first and exits 0", () => {
    expect(main(["--help"], io())).toBe(0);
    expect(out.startsWith("Examples:")).toBe(true);
  });

  it("turns color off when stdout is not a terminal, when NO_COLOR is set, and with --color off", () => {
    write("fail.json", toRetell(failedSample.evidence));
    main(["fail.json"], io());
    expect(out).toContain(ESC);
    for (const over of [{ isTTY: false }, { env: { NO_COLOR: "1" } }]) {
      out = "";
      main(["fail.json"], io(over));
      expect(out).not.toContain(ESC);
    }
    out = "";
    main(["fail.json", "--color", "off"], io());
    expect(out).not.toContain(ESC);
    out = "";
    main(["fail.json", "--color=on"], io({ isTTY: false }));
    expect(out).toContain(ESC);
  });

  it("reads a LiveKit session report", () => {
    const lk = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../eval/engine/cases/livekit-booking-error-said-booked.json"), "utf8")) as { record: unknown };
    write("lk.json", lk.record);
    expect(main(["lk.json", "--color", "off"], io())).toBe(1);
    expect(out).toMatch(/^Failed +AJ_offline /);
  });
});
