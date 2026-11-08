// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkCaseSet, formatCase, parseCase, type EvalCase } from "./case";

/** A valid case; each test changes one thing. */
function valid(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: "sample-failed",
    source: "real",
    independent: false,
    platform: "retell",
    locked: true,
    label: { by: "sample", at: "2026-11-06" },
    expect: { verdict: "failed" },
    record: { call_id: "call_x" },
    ...over,
  };
}

const problems = (raw: unknown): string => {
  try {
    parseCase(raw, "cases/x.json");
    return "";
  } catch (err) {
    return (err as Error).message;
  }
};

describe("parseCase", () => {
  it("reads a valid case", () => {
    const c: EvalCase = parseCase(valid(), "cases/x.json");
    expect(c.id).toBe("sample-failed");
    expect(c.expect.verdict).toBe("failed");
  });

  it("reads the optional fields: contracts, mustCite, a note, derivedFrom and tz", () => {
    const c = parseCase(
      valid({
        id: "mut-drop-transfer-001",
        source: "mutation",
        derivedFrom: "sample-failed",
        tz: "America/New_York",
        label: { by: "sample", at: "2026-11-06T10:00:00Z", note: "why" },
        expect: { verdict: "failed", contracts: { transfer_kept: "violated" }, mustCite: [{ contract: "transfer_kept", seqs: [25, 27] }] },
      }),
    );
    expect(c.expect.mustCite).toEqual([{ contract: "transfer_kept", seqs: [25, 27] }]);
    expect(c.tz).toBe("America/New_York");
  });

  it("names the file and every problem when a case is bad", () => {
    const msg = problems(valid({ source: "made_up", locked: "yes" }));
    expect(msg).toContain("cases/x.json");
    expect(msg).toContain("source");
    expect(msg).toContain("locked");
  });

  it.each([
    ["an unknown key, such as a typo", valid({ lockd: true })],
    ["an unknown key inside expect", valid({ expect: { verdict: "failed", contract: {} } })],
    ["a verdict that is not one of the three", valid({ expect: { verdict: "broken" } })],
    ["an unknown contract", valid({ expect: { verdict: "failed", contracts: { be_nice: "violated" } } })],
    ["an unknown result", valid({ expect: { verdict: "failed", contracts: { transfer_kept: "bad" } } })],
    ["a platform other than retell", valid({ platform: "vapi" })],
    ["an id that is not lowercase words and digits joined by hyphens", valid({ id: "Sample Failed" })],
    ["a missing label", valid({ label: undefined })],
    ["a label with no author", valid({ label: { by: "", at: "2026-11-06" } })],
    ["a label date that is not a date", valid({ label: { by: "sample", at: "last week" } })],
    ["a record that is not an object", valid({ record: "call_x" })],
    ["a time zone that is not an IANA zone", valid({ tz: "Mars/Base" })],
    ["a schema version from the future", valid({ schemaVersion: 2 })],
    ["mustCite with no seqs", valid({ expect: { verdict: "failed", mustCite: [{ contract: "transfer_kept", seqs: [] }] } })],
  ])("rejects %s", (_what, raw) => {
    expect(problems(raw)).not.toBe("");
  });

  it("accepts nothing_done as an expected verdict", () => {
    const c = parseCase(valid({ expect: { verdict: "nothing_done", contracts: { promise_backed: "not_applicable" } } }));
    expect(c.expect.verdict).toBe("nothing_done");
  });

  it("rejects a mutation with no parent, and a non-mutation with one", () => {
    expect(problems(valid({ source: "mutation" }))).toContain("derivedFrom");
    expect(problems(valid({ derivedFrom: "sample-passed" }))).toContain("derivedFrom");
  });

  it("rejects a mutation marked independent: we built it", () => {
    expect(problems(valid({ source: "mutation", derivedFrom: "sample-failed", independent: true }))).toContain("independent");
  });

  it.each([
    ["a passed verdict with a violated contract", { verdict: "passed", contracts: { transfer_kept: "violated" } }],
    ["a needs_review verdict with a violated contract", { verdict: "needs_review", contracts: { transfer_kept: "violated" } }],
    ["a passed verdict with an unverified contract", { verdict: "passed", contracts: { promise_backed: "unverified" } }],
    ["a nothing_done verdict with a violated contract", { verdict: "nothing_done", contracts: { transfer_kept: "violated" } }],
    ["a nothing_done verdict with an unverified contract", { verdict: "nothing_done", contracts: { promise_backed: "unverified" } }],
    ["mustCite on a contract expected not to apply", { verdict: "passed", contracts: { transfer_kept: "not_applicable" }, mustCite: [{ contract: "transfer_kept", seqs: [3] }] }],
  ])("rejects an expectation that contradicts itself: %s", (_what, expectation) => {
    expect(problems(valid({ expect: expectation }))).toContain("expect");
  });
});

describe("checkCaseSet", () => {
  const a = parseCase(valid({ id: "a" }));
  const b = parseCase(valid({ id: "b", source: "mutation", derivedFrom: "a" }));

  it("accepts unique ids whose parents exist", () => {
    expect(checkCaseSet([a, b])).toEqual([]);
  });

  it("reports a duplicate id", () => {
    expect(checkCaseSet([a, a])).toEqual(["two cases have the id a"]);
  });

  it("reports a mutation whose parent is not a case", () => {
    expect(checkCaseSet([b])).toEqual(["b is derived from a, which is not a case"]);
  });
});

describe("formatCase", () => {
  const c = parseCase(
    valid({
      expect: { verdict: "failed", contracts: { transfer_kept: "violated" }, mustCite: [{ contract: "transfer_kept", seqs: [25, 27] }] },
      record: {
        call_id: "call_x",
        transcript_with_tool_calls: [
          { role: "agent", content: "Hi there.", words: [{ word: "Hi", start: 1.5 }, { word: "there." }] },
          { role: "tool_call_invocation", tool_call_id: "tc_01", name: "book", arguments: "{}" },
        ],
      },
    }),
  );
  const text = formatCase(c);

  it("reads back to the same case", () => {
    expect(parseCase(JSON.parse(text))).toEqual(c);
  });

  it("keeps one transcript item per line where it can, so a diff shows the item that changed", () => {
    expect(text).toContain('\n      { "role": "tool_call_invocation", "tool_call_id": "tc_01", "name": "book", "arguments": "{}" }');
    expect(text).toContain('"words": [{ "word": "Hi", "start": 1.5 }, { "word": "there." }]');
    expect(text).toContain('"mustCite": [\n      { "contract": "transfer_kept", "seqs": [25, 27] }\n    ]');
  });

  it("puts the label and expectation before the record, and ends with a newline", () => {
    expect(text.indexOf('"label"')).toBeLessThan(text.indexOf('"expect"'));
    expect(text.indexOf('"expect"')).toBeLessThan(text.indexOf('"record"'));
    expect(text.endsWith("}\n")).toBe(true);
  });

  it("writes the keys in one order whatever order the case object has them in", () => {
    const shuffled = Object.fromEntries(Object.entries(c).reverse()) as EvalCase;
    expect(formatCase(shuffled)).toBe(text);
  });
});
