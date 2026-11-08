// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { PinCheck } from "./check";
import { buildReport, CheckReportSchema, formatJson, formatText } from "./format";

const held = (n: number): PinCheck => ({
  id: `pin-call-${n}-0000000${n}`,
  callId: `call_${n}`,
  pinnedAt: "2026-11-07T09:00:00-05:00",
  pinnedWith: "0.1.0",
  note: null,
  status: "held",
  expected: { verdict: "passed", contracts: {}, experience: {} },
  actual: { verdict: "passed", contracts: {}, experience: {} },
  changes: [],
  message: null,
});

const changed: PinCheck = {
  id: "pin-call-8f2a9c-1c9e0d4b",
  callId: "call_8f2a9c",
  pinnedAt: "2026-11-08T10:15:00-05:00",
  pinnedWith: "0.1.0",
  note: "nurse transfer promised, never made",
  status: "changed",
  expected: { verdict: "failed", contracts: { transfer_kept: "violated" }, experience: {} },
  actual: { verdict: "needs_review", contracts: { transfer_kept: "unverified" }, experience: {} },
  changes: [
    { what: "verdict", name: "verdict", was: "failed", now: "needs_review" },
    { what: "contract", name: "transfer_kept", was: "violated", now: "unverified" },
  ],
  message: null,
};

const base = { overhear: "0.1.0", dir: "/home/me/.overhear/pinned", problems: [] };
const seven = [...[1, 2, 3, 4, 5, 6].map(held), changed];

describe("formatText", () => {
  it("prints the count, then each changed pin with what changed and its note, and says how to see the rest", () => {
    expect(formatText(buildReport({ ...base, pins: seven }, { verbose: false }))).toBe(
      [
        "Overhear checked 7 pinned calls: 6 held, 1 changed.",
        "",
        "changed  pin-call-8f2a9c-1c9e0d4b  pinned 2026-11-08 with 0.1.0",
        "         verdict: was Failed, now Needs review",
        "         transfer_kept: was violated, now unverified",
        "         note: nurse transfer promised, never made",
        "",
        "Run with --json for every result.",
      ].join("\n"),
    );
  });

  it("says one pinned call in the singular, lists no held pin, and leaves out the note line when there is no note", () => {
    const text = formatText(buildReport({ ...base, pins: [held(1)] }, { verbose: false }));
    expect(text).toBe(["Overhear checked 1 pinned call: 1 held, 0 changed.", "", "Run with --json for every result."].join("\n"));
    const noNote = formatText(buildReport({ ...base, pins: [{ ...changed, note: null }] }, { verbose: false }));
    expect(noNote).not.toContain("note:");
  });

  it("says no pinned calls in the folder when there are none", () => {
    expect(formatText(buildReport({ ...base, pins: [] }, { verbose: false }))).toBe("No pinned calls in /home/me/.overhear/pinned.");
  });

  it("words a missing report and each kept item without one", () => {
    const none: PinCheck = {
      ...changed,
      actual: { verdict: "no_content", contracts: { transfer_kept: "no_report" }, experience: { spoken_format: "no_report" } },
      changes: [
        { what: "verdict", name: "verdict", was: "failed", now: "no_content" },
        { what: "contract", name: "transfer_kept", was: "violated", now: "no_report" },
        { what: "experience", name: "spoken_format", was: "clean", now: "no_report" },
      ],
    };
    const text = formatText(buildReport({ ...base, pins: [none] }, { verbose: false }));
    expect(text).toContain("verdict: was Failed, now no report (no content)");
    expect(text).toContain("transfer_kept: was violated, now no report");
    expect(text).toContain("spoken_format: was clean, now no report");
  });

  it("lists problems after the pins", () => {
    const text = formatText(buildReport({ ...base, pins: [held(1)], problems: [{ file: "pin-x.json", message: "pin-x.json is not valid JSON." }] }, { verbose: false }));
    expect(text).toContain("Could not use 1 file:\n  pin-x.json is not valid JSON.");
  });

  it("prints an engine message only with verbose, on one line", () => {
    const broken: PinCheck = {
      ...changed,
      actual: { ...changed.actual, verdict: "error" },
      changes: [{ what: "verdict", name: "verdict", was: "failed", now: "error" }],
      message: "the engine threw: boom\nsecond line",
    };
    const quiet = formatText(buildReport({ ...base, pins: [broken] }, { verbose: false }));
    expect(quiet).not.toContain("boom");
    const loud = formatText(buildReport({ ...base, pins: [broken] }, { verbose: true }));
    expect(loud).toContain("         engine: the engine threw: boom second line");
    expect(loud).toContain("verdict: was Failed, now no report (engine error)");
  });

  it("prints no control character from a path or a message", () => {
    const text = formatText(buildReport({ ...base, dir: "/tmp/\u001b[31mred", pins: [] }, { verbose: false }));
    expect(text).toBe("No pinned calls in /tmp/?[31mred.");
  });
});

describe("the JSON report", () => {
  const report = buildReport({ ...base, pins: seven }, { verbose: false });

  it("validates under the exported schema, with the counts and every pin", () => {
    const parsed = CheckReportSchema.parse(JSON.parse(formatJson(report)));
    expect(parsed).toMatchObject({ schemaVersion: 1, overhear: "0.1.0", dir: "/home/me/.overhear/pinned", checked: 7, held: 6, changed: 1, problems: [] });
    expect(parsed.pins).toHaveLength(7);
    expect(parsed.pins[6]).toMatchObject({ id: changed.id, callId: "call_8f2a9c", status: "changed", changes: changed.changes });
  });

  it("holds no engine message unless verbose, and rejects a key the schema does not know", () => {
    const broken: PinCheck = { ...changed, message: "the engine threw: boom" };
    expect(JSON.stringify(buildReport({ ...base, pins: [broken] }, { verbose: false }))).not.toContain("boom");
    expect(JSON.stringify(buildReport({ ...base, pins: [broken] }, { verbose: true }))).toContain("boom");
    const extra = { ...JSON.parse(formatJson(report)), transcript: "x" };
    expect(CheckReportSchema.safeParse(extra).success).toBe(false);
    const badPin = JSON.parse(formatJson(report));
    badPin.pins[0].status = "maybe";
    expect(CheckReportSchema.safeParse(badPin).success).toBe(false);
  });
});
