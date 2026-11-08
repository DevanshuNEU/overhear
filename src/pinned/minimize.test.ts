// @vitest-environment node
import { describe, expect, it } from "vitest";
import { loadCases } from "../../scripts/engine-evals/io";
import { analyzeRetellCall } from "@/engine/analyze";
import { sampleCases } from "@/engine/testing/sample-cases";
import type { Outcome } from "@/engine/types";
import { minimizeRecord } from "./minimize";

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => v as Rec;
const CANARY = "CANARY-7f3a";

/** A record that holds something in every top-level field the design keeps or drops, canary text in each dropped one. */
function fullRecord(): Rec {
  return {
    call_id: "call_abc123",
    agent_id: "agent_1",
    agent_version: 3,
    call_status: "ended",
    call_type: "phone_call",
    start_timestamp: 1_700_000_000_000,
    duration_ms: 61_000,
    disconnection_reason: "agent_hangup",
    data_storage_setting: "everything",
    opt_out_sensitive_data_storage: false,
    call_analysis: { call_successful: true, user_sentiment: "Neutral", in_voicemail: false, call_summary: CANARY, custom_analysis_data: { name: CANARY } },
    transcript_with_tool_calls: [
      { role: "agent", content: "Hello", words: [{ word: "Hello", start: 0.5, end: 0.9 }] },
      { role: "tool_call_invocation", tool_call_id: "t1", name: "book", arguments: JSON.stringify({ when: "2026-11-09T09:00" }) },
      { role: "tool_call_result", tool_call_id: "t1", successful: true, content: JSON.stringify({ ok: true, link: "https://example.com/a?sig=1" }) },
    ],
    scrubbed_transcript_with_tool_calls: [{ role: "agent", content: CANARY }],
    transcript_object: [{ role: "agent", content: CANARY }],
    transcript: `Agent: ${CANARY}`,
    access_token: CANARY,
    recording_url: `https://x/${CANARY}`,
    from_number: CANARY,
    metadata: { who: CANARY },
  };
}

describe("minimizeRecord", () => {
  it("keeps the allowlist and drops everything else, including a field nobody has heard of yet", () => {
    const out = asRec(minimizeRecord({ ...fullRecord(), brand_new_retell_field: CANARY }));
    expect(Object.keys(out).sort()).toEqual(
      [
        "agent_id",
        "agent_version",
        "call_analysis",
        "call_id",
        "call_status",
        "call_type",
        "data_storage_setting",
        "disconnection_reason",
        "duration_ms",
        "opt_out_sensitive_data_storage",
        "start_timestamp",
        "transcript_with_tool_calls",
      ].sort(),
    );
    expect(JSON.stringify(out)).not.toContain(CANARY);
  });

  it("keeps only three call_analysis fields", () => {
    const out = asRec(minimizeRecord(fullRecord()));
    expect(out.call_analysis).toEqual({ call_successful: true, user_sentiment: "Neutral", in_voicemail: false });
  });

  it("keeps the one transcript the adapter reads: the first that is a non-empty list", () => {
    const base = fullRecord();
    const scrubbed = asRec(minimizeRecord({ ...base, transcript_with_tool_calls: [] }));
    expect(Object.keys(scrubbed).filter((k) => k.includes("transcript"))).toEqual(["scrubbed_transcript_with_tool_calls"]);
    const object = asRec(minimizeRecord({ ...base, transcript_with_tool_calls: undefined, scrubbed_transcript_with_tool_calls: [] }));
    expect(Object.keys(object).filter((k) => k.includes("transcript"))).toEqual(["transcript_object"]);
    const none = asRec(minimizeRecord({ ...base, transcript_with_tool_calls: [], scrubbed_transcript_with_tool_calls: null, transcript_object: [] }));
    expect(Object.keys(none).filter((k) => k.includes("transcript"))).toEqual([]);
  });

  it("keeps utterances whole, tool arguments and results untouched, and shares nothing with the input", () => {
    const input = fullRecord();
    const before = structuredClone(input);
    const out = asRec(minimizeRecord(input));
    expect(out.transcript_with_tool_calls).toEqual(before.transcript_with_tool_calls);
    expect(input).toEqual(before);
    const list = out.transcript_with_tool_calls as Rec[];
    list[0].content = "changed";
    expect((input.transcript_with_tool_calls as Rec[])[0].content).toBe("Hello");
  });

  it("keeps links inside tool payloads, since they are the user's data", () => {
    const out = asRec(minimizeRecord(fullRecord()));
    expect(JSON.stringify(out.transcript_with_tool_calls)).toContain("https://example.com/a?sig=1");
  });

  it("removes the url of each SMS multimedia item and keeps its summary and the rest of the utterance", () => {
    const record = {
      ...fullRecord(),
      transcript_with_tool_calls: [
        { role: "sms", content: "photo", time_sec: 4, multimedia: [{ url: `https://x/${CANARY}`, summary: "a card" }, { url: "https://x/2" }] },
        { role: "agent", content: "ok", multimedia: [{ url: "https://x/keep-on-non-sms" }] },
      ],
    };
    const list = asRec(minimizeRecord(record)).transcript_with_tool_calls as Rec[];
    expect(list[0]).toEqual({ role: "sms", content: "photo", time_sec: 4, multimedia: [{ summary: "a card" }, {}] });
    expect(JSON.stringify(list[0])).not.toContain("url");
    expect(list[1]).toEqual(record.transcript_with_tool_calls[1]);
  });

  it("keeps a top-level field only when it holds plain text, a finite number or a boolean", () => {
    const out = asRec(minimizeRecord({ ...fullRecord(), agent_id: { signed: CANARY }, duration_ms: Number.NaN, call_type: ["x"], call_status: null }));
    expect(Object.keys(out)).not.toEqual(expect.arrayContaining(["agent_id", "duration_ms", "call_type", "call_status"]));
    expect(JSON.stringify(out)).not.toContain(CANARY);
  });

  it("drops a call_analysis field of the wrong type and keeps an empty analysis as an empty object", () => {
    expect(asRec(minimizeRecord({ call_id: "c", call_analysis: { call_successful: "yes", user_sentiment: 1, in_voicemail: null } })).call_analysis).toEqual({});
    expect(asRec(minimizeRecord({ call_id: "c", call_analysis: "x" }))).not.toHaveProperty("call_analysis");
  });

  it("reads a record wrapped in a webhook body the way the adapter does", () => {
    const out = asRec(minimizeRecord({ event: "call_ended", call: fullRecord() }));
    expect(out.call_id).toBe("call_abc123");
    expect(out).not.toHaveProperty("event");
    expect(JSON.stringify(out)).not.toContain(CANARY);
  });

  it.each([null, undefined, "text", 5, [], [fullRecord()]])("gives an empty record for %j, never the input", (raw) => {
    expect(minimizeRecord(raw)).toEqual({});
  });

  it("keeps a __proto__ key in a tool result as data and does not touch the prototype", () => {
    const record = JSON.parse(
      `{"call_id":"c","__proto__":{"polluted":true},"transcript_with_tool_calls":[{"role":"tool_call_result","tool_call_id":"t","content":"{}","__proto__":{"polluted":true}}]}`,
    ) as unknown;
    const out = asRec(minimizeRecord(record));
    expect(Object.keys(out)).toEqual(["call_id", "transcript_with_tool_calls"]);
    const first = (out.transcript_with_tool_calls as Rec[])[0];
    expect(Object.keys(first)).toContain("__proto__");
    expect(({} as Rec).polluted).toBeUndefined();
    expect(first.polluted).toBeUndefined();
  });
});

/** What a pin promises to keep: the verdict, the contract results with their findings, and the experience checks. */
function outcomeView(out: Outcome): unknown {
  if (out.kind !== "report") return out;
  const r = out.report;
  return {
    kind: out.kind,
    verdict: r.verdict,
    headline: r.headline,
    notes: r.notes,
    reasons: r.reasons,
    results: r.results,
    experience: r.experience,
    detections: r.detections,
    request: r.request,
    policy: r.policy,
    items: r.evidence.items,
  };
}

describe("a trimmed record reads the same as the full one", () => {
  const cases = [...loadCases(), ...sampleCases()];

  it("covers the committed cases and the three samples", () => {
    expect(cases.length).toBeGreaterThanOrEqual(35);
    expect(cases.map((c) => c.id)).toEqual(expect.arrayContaining(["sample-failed", "sample-needs-review", "sample-passed"]));
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const options = { tz: c.tz ?? "UTC" };
    const full = analyzeRetellCall(c.record, options);
    const trimmed = analyzeRetellCall(minimizeRecord(c.record), options);
    expect(outcomeView(trimmed)).toEqual(outcomeView(full));
  });
});
