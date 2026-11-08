// @vitest-environment node
// The pinned-call allowlist against what the Retell SDK says a call record holds. It lives here, not in src/pinned,
// because src/pinned never imports the SDK: this file takes types from it, and the types are erased.
import type { PhoneCallResponse, WebCallResponse } from "retell-sdk/resources/call";
import { describe, expect, it } from "vitest";
import { minimizeRecord } from "@/pinned/minimize";

const CANARY = "CANARY-sdk";

// Each map must name every key of its SDK type (SHARED the keys both types have): TypeScript refuses a missing key (a field Retell added) and an
// unknown one (a field it removed), so a new SDK field fails typecheck here until someone decides keep or drop.
const SHARED: Record<keyof WebCallResponse & keyof PhoneCallResponse, unknown> = {
  agent_id: "agent_1",
  agent_name: CANARY,
  agent_tag: CANARY,
  agent_version: 2,
  call_analysis: { call_successful: true, call_summary: CANARY, custom_analysis_data: { x: CANARY }, in_voicemail: false, user_sentiment: "Neutral" },
  call_cost: { total: 1 },
  call_id: "call_1",
  call_status: "ended",
  call_type: "web_call",
  collected_dynamic_variables: { x: CANARY },
  custom_sip_headers: { x: CANARY },
  data_storage_setting: "everything",
  disconnection_reason: "agent_hangup",
  duration_ms: 1000,
  end_timestamp: 2000,
  knowledge_base_retrieved_contents_url: `https://x/${CANARY}`,
  latency: { e2e: {} },
  llm_token_usage: { average: 1 },
  metadata: { x: CANARY },
  opt_in_signed_url: true,
  public_log_url: `https://x/${CANARY}`,
  recording_multi_channel_url: `https://x/${CANARY}`,
  recording_url: `https://x/${CANARY}`,
  retell_llm_dynamic_variables: { x: CANARY },
  scrubbed_recording_multi_channel_url: `https://x/${CANARY}`,
  scrubbed_recording_url: `https://x/${CANARY}`,
  scrubbed_transcript_with_tool_calls: [{ role: "agent", content: CANARY }],
  start_timestamp: 1000,
  transcript: CANARY,
  transcript_object: [{ role: "agent", content: CANARY }],
  transcript_with_tool_calls: [{ role: "agent", content: "kept", words: [] }],
  transfer_destination: CANARY,
  transfer_end_timestamp: 3000,
};

const WEB: Record<keyof WebCallResponse, unknown> = { ...SHARED, access_token: CANARY };

const PHONE: Record<keyof PhoneCallResponse, unknown> = {
  ...SHARED,
  direction: "inbound",
  from_number: CANARY,
  to_number: CANARY,
  telephony_identifier: { twilio_call_sid: CANARY },
};

// The allowlist, written out: what the design keeps. Every other SDK field must be gone.
const KEPT = [
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
];

describe("the allowlist against the SDK's call types", () => {
  it.each([
    ["WebCallResponse", WEB],
    ["PhoneCallResponse", PHONE],
  ])("a %s record keeps exactly the allowlist, nothing else", (_name, shape) => {
    // opt_out_sensitive_data_storage is on no SDK type today but is a field the adapter reads, so a record may hold it.
    const record = { ...shape, opt_out_sensitive_data_storage: true };
    const out = minimizeRecord(record) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(KEPT);
    expect(out.call_analysis).toEqual({ call_successful: true, in_voicemail: false, user_sentiment: "Neutral" });
    expect(JSON.stringify(out)).not.toContain(CANARY);
  });

  it("every SDK field that is not kept is dropped", () => {
    const dropped = Object.keys({ ...WEB, ...PHONE }).filter((k) => !KEPT.includes(k));
    const out = minimizeRecord({ ...WEB, ...PHONE }) as Record<string, unknown>;
    expect(dropped.filter((k) => k in out)).toEqual([]);
    expect(dropped).toEqual(expect.arrayContaining(["access_token", "recording_url", "from_number", "to_number", "telephony_identifier", "metadata", "transcript"]));
  });
});

// Tripwires for the types nested inside a call record. Each map names every key of its SDK type, so a field Retell
// adds inside an utterance, a word, an SMS attachment or the analysis fails typecheck until someone decides whether
// a pin keeps it (utterances are kept whole, so a new field would be written to disk unseen). The Web and Phone
// versions of each type must have the same keys: the type below is never true when they differ.
type Keys<T> = Record<keyof T, unknown>;
type SameKeys<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? true : never) : never;

const UTTERANCE: Keys<WebCallResponse.Utterance> = { content: "hi", role: "agent", words: [] };
const WORD: Keys<WebCallResponse.Utterance.Word> = { start: 0, end: 1, word: "hi" };
const TRANSCRIPT_OBJECT: Keys<WebCallResponse.TranscriptObject> = { content: "hi", role: "user", words: [] };
const TRANSCRIPT_OBJECT_WORD: Keys<WebCallResponse.TranscriptObject.Word> = { start: 0, end: 1, word: "hi" };
const TOOL_CALL: Keys<WebCallResponse.ToolCallInvocationUtterance> = { role: "tool_call_invocation", tool_call_id: "t1", name: "book", arguments: "{}", thought_signature: CANARY };
const TOOL_RESULT: Keys<WebCallResponse.ToolCallResultUtterance> = { role: "tool_call_result", tool_call_id: "t1", content: "{}", successful: true };
const NODE: Keys<WebCallResponse.NodeTransitionUtterance> = {
  role: "node_transition",
  former_node_id: "a",
  former_node_name: "A",
  new_node_id: "b",
  new_node_name: "B",
  transition_type: "normal",
};
const DTMF: Keys<WebCallResponse.DtmfUtterance> = { role: "dtmf", digit: "1" };
const SMS: Keys<WebCallResponse.SMSUtterance> = { role: "sms", content: "photo", time_sec: 3, multimedia: [{ url: `https://x/${CANARY}`, summary: "a card" }] };
const MULTIMEDIA: Keys<WebCallResponse.SMSUtterance.Multimedia> = { url: `https://x/${CANARY}`, summary: "a card" };
const INJECTED: Keys<WebCallResponse.InjectedUtterance> = { role: "injected", content: "note", time_sec: 2 };
const ANALYSIS: Keys<WebCallResponse.CallAnalysis> = { call_successful: true, call_summary: CANARY, custom_analysis_data: {}, in_voicemail: false, user_sentiment: "Neutral" };

const SAME: true[] = [
  true satisfies SameKeys<WebCallResponse.Utterance, PhoneCallResponse.Utterance>,
  true satisfies SameKeys<WebCallResponse.Utterance.Word, PhoneCallResponse.Utterance.Word>,
  true satisfies SameKeys<WebCallResponse.TranscriptObject, PhoneCallResponse.TranscriptObject>,
  true satisfies SameKeys<WebCallResponse.TranscriptObject.Word, PhoneCallResponse.TranscriptObject.Word>,
  true satisfies SameKeys<WebCallResponse.ToolCallInvocationUtterance, PhoneCallResponse.ToolCallInvocationUtterance>,
  true satisfies SameKeys<WebCallResponse.ToolCallResultUtterance, PhoneCallResponse.ToolCallResultUtterance>,
  true satisfies SameKeys<WebCallResponse.NodeTransitionUtterance, PhoneCallResponse.NodeTransitionUtterance>,
  true satisfies SameKeys<WebCallResponse.DtmfUtterance, PhoneCallResponse.DtmfUtterance>,
  true satisfies SameKeys<WebCallResponse.SMSUtterance, PhoneCallResponse.SMSUtterance>,
  true satisfies SameKeys<WebCallResponse.SMSUtterance.Multimedia, PhoneCallResponse.SMSUtterance.Multimedia>,
  true satisfies SameKeys<WebCallResponse.InjectedUtterance, PhoneCallResponse.InjectedUtterance>,
  true satisfies SameKeys<WebCallResponse.CallAnalysis, PhoneCallResponse.CallAnalysis>,
];

describe("utterances against the SDK's nested types", () => {
  it("the Web and Phone versions of every nested type have the same keys", () => {
    expect(SAME).toHaveLength(12);
  });

  it("every kind of utterance is kept whole, except thought_signature and an SMS attachment url", () => {
    const words = [WORD, TRANSCRIPT_OBJECT_WORD];
    const list: Record<string, unknown>[] = [UTTERANCE, TRANSCRIPT_OBJECT].map((u) => ({ ...u, words }));
    list.push(TOOL_CALL, TOOL_RESULT, NODE, DTMF, SMS, INJECTED);
    const kept = (minimizeRecord({ call_id: "c", transcript_with_tool_calls: list }) as { transcript_with_tool_calls: Record<string, unknown>[] }).transcript_with_tool_calls;
    expect(kept).toHaveLength(list.length);
    for (const [i, u] of kept.entries()) {
      const { thought_signature, multimedia, ...rest } = list[i];
      const { multimedia: keptMedia, ...keptRest } = u;
      expect(keptRest).toEqual(rest);
      expect(keptMedia === undefined).toBe(multimedia === undefined);
      expect(thought_signature === undefined || !("thought_signature" in u)).toBe(true);
    }
    expect(JSON.stringify(kept)).not.toContain(CANARY);
    expect(kept[6].multimedia).toEqual([{ summary: MULTIMEDIA.summary }]);
  });

  it("keeps only the three analysis flags the SDK lists", () => {
    const out = minimizeRecord({ call_id: "c", call_analysis: ANALYSIS }) as { call_analysis: Record<string, unknown> };
    expect(Object.keys(out.call_analysis).sort()).toEqual(["call_successful", "in_voicemail", "user_sentiment"]);
  });
});
