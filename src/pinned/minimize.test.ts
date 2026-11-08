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

  it("drops thought_signature from every kept utterance and leaves the rest of it alone", () => {
    const record = {
      call_id: "c",
      transcript_with_tool_calls: [
        { role: "tool_call_invocation", tool_call_id: "t1", name: "book", arguments: "{}", thought_signature: CANARY },
        { role: "agent", content: "hi", words: [], thought_signature: CANARY },
        { role: "tool_call_result", tool_call_id: "t1", content: "{}", successful: true },
      ],
    };
    const list = asRec(minimizeRecord(record)).transcript_with_tool_calls as Rec[];
    expect(list[0]).toEqual({ role: "tool_call_invocation", tool_call_id: "t1", name: "book", arguments: "{}" });
    expect(list[1]).toEqual({ role: "agent", content: "hi", words: [] });
    expect(list[2]).toEqual(record.transcript_with_tool_calls[2]);
    expect(JSON.stringify(list)).not.toContain(CANARY);
  });

  it("drops an SMS multimedia that is not a list, strips the url of a single object, and drops non-object items", () => {
    const sms = (multimedia: unknown): Rec => ({ role: "sms", content: "x", time_sec: 1, multimedia });
    const kept = (u: Rec): Rec => (asRec(minimizeRecord({ call_id: "c", transcript_with_tool_calls: [u] })).transcript_with_tool_calls as Rec[])[0];
    expect(kept(sms(`https://x/${CANARY}`))).toEqual({ role: "sms", content: "x", time_sec: 1 });
    expect(kept(sms(null))).toEqual({ role: "sms", content: "x", time_sec: 1 });
    expect(kept(sms({ url: `https://x/${CANARY}`, summary: "s" }))).toEqual({ role: "sms", content: "x", time_sec: 1, multimedia: { summary: "s" } });
    expect(kept(sms([`https://x/${CANARY}`, { url: "https://x/2", summary: "s" }]))).toEqual({ role: "sms", content: "x", time_sec: 1, multimedia: [{ summary: "s" }] });
  });

  it("gives an empty record, and does not throw, when the input is too deeply nested to copy", () => {
    let deep: Rec = { role: "tool_call_result", tool_call_id: "t", content: "x" };
    for (let i = 0; i < 200_000; i++) deep = { next: deep };
    const record = { call_id: "c", transcript_with_tool_calls: [{ role: "agent", content: "hi" }, deep] };
    expect(() => minimizeRecord(record)).not.toThrow();
    expect(minimizeRecord(record)).toEqual({});
  });

  it("reads call, call_analysis and the transcripts as own properties only, never from the prototype", () => {
    const proto = { call_id: "inherited", call_analysis: { call_successful: true }, transcript_with_tool_calls: [{ role: "agent", content: CANARY }] };
    const inherited = Object.create(proto) as Rec;
    expect(minimizeRecord(inherited)).toEqual({});
    const wrapped = Object.create({ call: { call_id: "inherited", agent_id: CANARY } }) as Rec;
    expect(minimizeRecord(wrapped)).toEqual({});
    const partly = Object.assign(Object.create(proto) as Rec, { call_id: "own" });
    expect(minimizeRecord(partly)).toEqual({ call_id: "own" });
    const analysis = Object.assign(Object.create(null) as Rec, { call_id: "own", call_analysis: Object.create({ call_successful: true }) });
    expect(asRec(minimizeRecord(analysis)).call_analysis).toEqual({});
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

describe("a pinned call with an SMS attachment", () => {
  it("reads the same, and its items differ only by the attachment url", () => {
    const base = sampleCases().find((c) => c.id === "sample-passed");
    if (!base) throw new Error("sample-passed is missing");
    const list = base.record.transcript_with_tool_calls as Rec[];
    const sms = { role: "sms", content: "photo of the card", time_sec: 5, multimedia: [{ url: `https://x/${CANARY}`, summary: "an insurance card" }] };
    const record = { ...base.record, transcript_with_tool_calls: [list[0], sms, ...list.slice(1)] };
    const options = { tz: base.tz ?? "UTC" };

    const full = analyzeRetellCall(record, options);
    const trimmed = analyzeRetellCall(minimizeRecord(record), options);
    if (full.kind !== "report" || trimmed.kind !== "report") throw new Error("both records should give a report");
    expect(trimmed.report.verdict).toBe(full.report.verdict);
    expect(trimmed.report.results).toEqual(full.report.results);
    expect(trimmed.report.experience).toEqual(full.report.experience);

    const smsItem = (r: typeof full) => r.report.evidence.items.find((i) => i.kind === "event" && i.type === "sms");
    expect(JSON.stringify(smsItem(full))).toContain(CANARY);
    expect(JSON.stringify(smsItem(trimmed))).not.toContain(CANARY);
    const withoutUrl = (r: typeof full) => JSON.stringify(r.report.evidence.items).replace(/"url":"[^"]*",?/g, "").replace(/,}/g, "}");
    expect(withoutUrl(trimmed)).toBe(withoutUrl(full));
  });
});
