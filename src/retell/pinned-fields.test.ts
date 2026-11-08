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
