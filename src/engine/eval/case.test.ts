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

/** A valid pinned call; each test changes one thing. */
function pinned(over: Record<string, unknown> = {}): Record<string, unknown> {
  return valid({
    id: "pin-call-8f2a9c-1c9e0d4b",
    tz: "America/New_York",
    label: { by: "you", at: "2026-11-08T10:15:00-05:00", note: "nurse transfer promised, never made" },
    record: { call_id: "call_8f2a9c" },
    pin: { callId: "call_8f2a9c", agentId: "agent_1c9e0d", agentVersion: "3", pinnedWith: "0.1.0" },
    expect: { verdict: "failed", contracts: { transfer_kept: "violated" }, experience: { agent_ends_call: "problem", error_handled: "clean" } },
    ...over,
  });
}

describe("a pinned call", () => {
  it("reads, with its pin block and kept experience checks", () => {
    const c = parseCase(pinned(), "pin.json");
    expect(c.pin).toEqual({ callId: "call_8f2a9c", agentId: "agent_1c9e0d", agentVersion: "3", pinnedWith: "0.1.0" });
    expect(c.expect.experience).toEqual({ agent_ends_call: "problem", error_handled: "clean" });
  });

  it("reads a fix pin and a call with no agent version", () => {
    const c = parseCase(
      pinned({
        id: "pin-call-2-1",
        record: { call_id: "call_2" },
        pin: { callId: "call_2", agentId: "agent_1", agentVersion: null, pinnedWith: "0.1.0", fixes: "pin-call-8f2a9c-1c9e0d4b" },
      }),
    );
    expect(c.pin?.fixes).toBe("pin-call-8f2a9c-1c9e0d4b");
  });

  it("leaves an existing case without a pin or kept experience checks reading as before", () => {
    const c = parseCase(valid());
    expect(c.pin).toBeUndefined();
    expect(c.expect.experience).toBeUndefined();
  });

  it("rejects a pin with no time zone, naming tz", () => {
    expect(problems(pinned({ tz: undefined }))).toContain("tz");
  });

  it.each([
    ["a source that is not real", { source: "external" }, "source"],
    ["a case that is not locked", { locked: false }, "locked"],
    ["a case marked independent", { independent: true }, "independent"],
    ["a note over 280 characters", { label: { by: "you", at: "2026-11-08", note: "x".repeat(281) } }, "label.note"],
    ["a note over one line", { label: { by: "you", at: "2026-11-08", note: "one\ntwo" } }, "label.note"],
    ["a call id with a slash", { pin: { callId: "a/b", agentId: "agent_1", agentVersion: "1", pinnedWith: "0.1.0" } }, "pin.callId"],
    ["a pin with an unknown key", { pin: { callId: "c", agentId: "a", agentVersion: "1", pinnedWith: "0.1.0", extra: 1 } }, "pin"],
    ["a pin missing pinnedWith", { pin: { callId: "c", agentId: "a", agentVersion: "1" } }, "pin.pinnedWith"],
    ["an unknown experience check", { expect: { verdict: "failed", experience: { rude: "problem" } } }, "expect"],
    ["an experience expectation that is not problem or clean", { expect: { verdict: "failed", experience: { agent_ends_call: "bad" } } }, "expect"],
  ])("rejects %s", (_what, over, where) => {
    expect(problems(pinned(over))).toContain(where);
  });

  it.each([
    ["a control character in the note (escape)", { label: { by: "you", at: "2026-11-08", note: "red \u001b[31m text" } }, "label.note"],
    ["a control character in the note (NUL)", { label: { by: "you", at: "2026-11-08", note: "a\u0000b" } }, "label.note"],
    ["a C1 control character in the note", { label: { by: "you", at: "2026-11-08", note: "a\u0085b" } }, "label.note"],
    ["a line separator in the note", { label: { by: "you", at: "2026-11-08", note: "a\u{2028}b" } }, "label.note"],
    ["a paragraph separator in the note", { label: { by: "you", at: "2026-11-08", note: "a\u{2029}b" } }, "label.note"],
    ["a label.by other than you", { label: { by: "alice", at: "2026-11-08" } }, "label.by"],
    ["a pinnedWith with a space", { pin: { callId: "c", agentId: "a", agentVersion: null, pinnedWith: "0.1.0 beta" } }, "pin.pinnedWith"],
    ["a pinnedWith with a control character", { pin: { callId: "c", agentId: "a", agentVersion: null, pinnedWith: "0.1\u001b[0m" } }, "pin.pinnedWith"],
    ["a pinnedWith over 64 characters", { pin: { callId: "c", agentId: "a", agentVersion: null, pinnedWith: "1".repeat(65) } }, "pin.pinnedWith"],
    ["an agentVersion with a newline", { pin: { callId: "c", agentId: "a", agentVersion: "1\n2", pinnedWith: "0.1.0" } }, "pin.agentVersion"],
    ["an empty agentVersion", { pin: { callId: "c", agentId: "a", agentVersion: "", pinnedWith: "0.1.0" } }, "pin.agentVersion"],
    ["an agentId with a space", { pin: { callId: "c", agentId: "a b", agentVersion: null, pinnedWith: "0.1.0" } }, "pin.agentId"],
    ["a fix pin that fixes itself", { pin: { callId: "call_8f2a9c", agentId: "agent_1c9e0d", agentVersion: null, pinnedWith: "0.1.0", fixes: "pin-call-8f2a9c-1c9e0d4b" } }, "pin.fixes"],
    ["a record call_id that is not the pin's callId", { record: { call_id: "call_other" } }, "record.call_id"],
    ["a record with no call_id", { record: {} }, "record.call_id"],
    ["a record agent_id that is not the pin's agentId", { record: { call_id: "call_8f2a9c", agent_id: "agent_other" } }, "record.agent_id"],
  ])("rejects %s", (_what, over, where) => {
    expect(problems(pinned({ record: { call_id: "call_8f2a9c" }, ...over }))).toContain(where);
  });

  it.each([
    ["a right-to-left override (U+202E)", "\u{202E}"],
    ["a bidi embedding (U+202A)", "\u{202A}"],
    ["a bidi pop (U+202C)", "\u{202C}"],
    ["a bidi isolate (U+2066)", "\u{2066}"],
    ["a bidi isolate pop (U+2069)", "\u{2069}"],
    ["a zero-width space (U+200B)", "\u{200B}"],
    ["a left-to-right mark (U+200E)", "\u{200E}"],
    ["a right-to-left mark (U+200F)", "\u{200F}"],
    ["a byte order mark (U+FEFF)", "\u{FEFF}"],
    ["a tag character (U+E0041)", "\u{E0041}"],
    ["the first tag character (U+E0000)", "\u{E0000}"],
    ["the last tag character (U+E007F)", "\u{E007F}"],
  ])("rejects invisible format characters in the note: %s", (_what, ch) => {
    expect(problems(pinned({ label: { by: "you", at: "2026-11-08", note: `a${ch}b` } }))).toContain("label.note");
  });

  it("accepts ordinary non-ASCII text in the note", () => {
    expect(problems(pinned({ label: { by: "you", at: "2026-11-08", note: "caf\u{E9} d\u{E9}j\u{E0} vu, \u{65E5}\u{672C}\u{8A9E}" } }))).toBe("");
  });

  it("accepts a record whose call_id and agent_id match the pin, and a record with no agent_id", () => {
    expect(problems(pinned({ record: { call_id: "call_8f2a9c", agent_id: "agent_1c9e0d" } }))).toBe("");
    expect(problems(pinned({ record: { call_id: "call_8f2a9c" } }))).toBe("");
  });

  it("accepts the version shapes Overhear and Retell write", () => {
    const pin = { callId: "call_8f2a9c", agentId: "agent_1c9e0d", agentVersion: "v2_3.1", pinnedWith: "0.1.0-rc.1+build5" };
    expect(problems(pinned({ record: { call_id: "call_8f2a9c" }, pin }))).toBe("");
  });

  it("accepts a note of exactly 280 characters", () => {
    expect(problems(pinned({ label: { by: "you", at: "2026-11-08", note: "x".repeat(280) } }))).toBe("");
  });

  it("still lets a case without a pin have a long note", () => {
    expect(problems(valid({ label: { by: "sample", at: "2026-11-06", note: "x".repeat(400) } }))).toBe("");
  });
});

describe("formatCase for a pin", () => {
  const c = parseCase(pinned({ record: { call_id: "call_8f2a9c", transcript_with_tool_calls: [{ role: "agent", content: "Hi there." }] } }));
  const text = formatCase(c);

  it("round-trips byte for byte", () => {
    expect(formatCase(parseCase(JSON.parse(text)))).toBe(text);
  });

  it("writes the pin right after the label, and before tz and the expectation", () => {
    const at = (key: string): number => text.indexOf(`"${key}"`);
    expect(at("label")).toBeLessThan(at("pin"));
    expect(at("pin")).toBeLessThan(at("tz"));
    expect(at("tz")).toBeLessThan(at("expect"));
    expect(at("expect")).toBeLessThan(at("record"));
  });

  it("writes the keys in one order whatever order the case object has them in", () => {
    const shuffled = Object.fromEntries(Object.entries(c).reverse()) as EvalCase;
    expect(formatCase(shuffled)).toBe(text);
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
