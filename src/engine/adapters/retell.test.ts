// @vitest-environment node
// The Retell adapter: one get-call record in, evidence or a plain no_content out. Records here are made up with
// the seed's names, or built from the three scrubbed samples by toRetell. None is a real call.
import { describe, expect, it } from "vitest";
import { EvidenceSchema, type Evidence, type Item } from "@/report/schema";
import { NO_CONTENT_REASONS, NOT_A_RETELL_CALL } from "@/report/labels";
import { SAMPLE_REPORTS, failedSample } from "@/report/samples";
import { toRetell } from "../testing/retell";
import { InputError } from "../types";
import { GAP_DETAIL } from "../wording";
import { fromRetell, type Adapted } from "./retell";

type Raw = Record<string, unknown>;

/** A made-up ended web call with a booking in it, with fields overridden by `over`. */
function call(over: Raw = {}): Raw {
  return {
    call_id: "call_jordan",
    call_type: "web_call",
    agent_id: "agent_northwind",
    agent_version: 3,
    call_status: "ended",
    start_timestamp: 1793911370896,
    end_timestamp: 1793911519708,
    duration_ms: 148812,
    disconnection_reason: "user_hangup",
    transcript_with_tool_calls: [
      { role: "agent", content: "Hi, this is Northwind Clinic.", words: [{ word: "Hi,", start: 0.5, end: 0.7 }] },
      { role: "user", content: "I'd like to book with Dr. Priya Nair.", words: [{ word: "I'd", start: 4.4, end: 4.6 }] },
      { role: "tool_call_invocation", tool_call_id: "tc_1", name: "book_appointment", arguments: '{"slotId":"s-1","patientName":"Jordan Ellis"}' },
      { role: "tool_call_result", tool_call_id: "tc_1", content: '{"ok":true,"appointmentId":"a-1"}', successful: true },
      { role: "agent", content: "You're booked with Dr. Priya Nair.", words: [] },
    ],
    ...over,
  };
}

/** Adapts a record and returns its evidence, failing the test when it is anything else or does not validate. */
function evidenceOf(raw: unknown): Evidence {
  const out = fromRetell(raw);
  if (out.kind !== "evidence") throw new Error(`expected evidence, got ${JSON.stringify(out)}`);
  expect(EvidenceSchema.parse(out.evidence)).toEqual(out.evidence);
  const callIds = new Set(out.evidence.items.flatMap((it) => (it.kind === "tool_call" ? [it.id] : [])));
  for (const it of out.evidence.items) if (it.kind === "tool_result") expect(callIds.has(it.id)).toBe(true);
  return out.evidence;
}

/** The items with the given kind. */
const ofKind = <K extends Item["kind"]>(e: Evidence, kind: K) => e.items.filter((it): it is Extract<Item, { kind: K }> => it.kind === kind);

describe("fromRetell", () => {
  it("numbers items from 1 in record order and parses string arguments", () => {
    const e = evidenceOf(call());
    expect(e.items.map((it) => it.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(e.items.map((it) => it.kind)).toEqual(["turn", "turn", "tool_call", "tool_result", "turn"]);
    expect(e.items[0]).toEqual({ kind: "turn", seq: 1, role: "agent", text: "Hi, this is Northwind Clinic.", startSec: 0.5, interrupted: null });
    expect(e.items[1]).toMatchObject({ kind: "turn", role: "caller", startSec: 4.4 });
    expect(e.items[2]).toEqual({ kind: "tool_call", seq: 3, id: "tc_1", name: "book_appointment", args: { slotId: "s-1", patientName: "Jordan Ellis" } });
    expect(e.items[3]).toMatchObject({ kind: "tool_result", id: "tc_1", payload: { ok: true, appointmentId: "a-1" } });
    expect(e.items[4]).toMatchObject({ kind: "turn", startSec: null });
    expect(e).toMatchObject({ callId: "call_jordan", platform: "retell", tier: 1, ordering: "sequence", gaps: [] });
  });

  it("keeps successful as platformOk and leaves ok null", () => {
    const e = evidenceOf(
      call({
        transcript_with_tool_calls: [
          { role: "tool_call_invocation", tool_call_id: "a", name: "check_availability", arguments: "{}" },
          { role: "tool_call_result", tool_call_id: "a", content: "{}", successful: true },
          { role: "tool_call_invocation", tool_call_id: "b", name: "check_availability", arguments: "{}" },
          { role: "tool_call_result", tool_call_id: "b", content: "HTTP 500", successful: false },
          { role: "tool_call_invocation", tool_call_id: "c", name: "check_availability", arguments: "{}" },
          { role: "tool_call_result", tool_call_id: "c", content: "{}" },
        ],
      }),
    );
    expect(ofKind(e, "tool_result").map((r) => [r.ok, r.platformOk])).toEqual([
      [null, true],
      [null, false],
      [null, null],
    ]);
  });

  it("turns transfer_target, node_transition, dtmf, sms and injected into events", () => {
    const items = [
      { role: "transfer_target", content: "Nurse line, this is Morgan.", words: [] },
      { role: "node_transition", former_node_id: "n1", former_node_name: "Greet", new_node_id: "n2", new_node_name: "Book" },
      { role: "dtmf", digit: "1" },
      { role: "sms", content: "Running late", time_sec: 12.5 },
      { role: "injected", content: "Caller is a returning patient", time_sec: 3 },
    ];
    const e = evidenceOf(call({ transcript_with_tool_calls: items }));
    expect(e.items).toEqual(
      items.map(({ role, ...data }, i) => ({ kind: "event", seq: i + 1, type: role, data })),
    );
  });

  it("copies only the allowed call fields", () => {
    const e = evidenceOf(
      call({
        recording_url: "https://example.com/recording.wav",
        public_log_url: "https://example.com/log",
        transcript: "Agent: Hi",
        retell_llm_dynamic_variables: { patient: "Jordan Ellis" },
        opt_out_sensitive_data_storage: false,
        llm_token_usage: { values: [1, 2], average: 1.5, num_requests: 2 },
        latency: { e2e: { p50: 800 } },
        call_analysis: {
          call_successful: true,
          call_summary: "Jordan Ellis booked with Dr. Priya Nair.",
          user_sentiment: "Positive",
          in_voicemail: false,
          custom_analysis_data: { reason: "booking" },
          agent_task_completion_rating: "Complete",
        },
      }),
    );
    expect(e.callFields).toEqual({
      call_type: "web_call",
      disconnection_reason: "user_hangup",
      duration_ms: 148812,
      call_analysis: {
        call_successful: true,
        call_summary: "Jordan Ellis booked with Dr. Priya Nair.",
        user_sentiment: "Positive",
        in_voicemail: false,
        custom_analysis_data: { reason: "booking" },
      },
    });
  });

  it("drops a call field of the wrong type instead of failing the record", () => {
    const e = evidenceOf(call({ call_type: 7, duration_ms: "long", call_analysis: { call_successful: "yes", custom_analysis_data: [1] } }));
    expect(e.callFields).toEqual({ disconnection_reason: "user_hangup", call_analysis: {} });
  });

  it("hands back the agent id beside the evidence, not inside it", () => {
    const out = fromRetell(call());
    expect(out.kind === "evidence" && out.agentId).toBe("agent_northwind");
    expect(JSON.stringify((out as { evidence: Evidence }).evidence)).not.toContain("agent_northwind");
    for (const agent_id of [undefined, "", 7, null, {}]) {
      const none = fromRetell(call({ agent_id }));
      expect(none.kind === "evidence" && none.agentId).toBeNull();
    }
    const wrapped = fromRetell({ event: "call_analyzed", call: call() });
    expect(wrapped.kind === "evidence" && wrapped.agentId).toBe("agent_northwind");
  });

  it("reads start_timestamp into callStartMs and agent_version into agentVersion", () => {
    expect(evidenceOf(call())).toMatchObject({ callStartMs: 1793911370896, agentVersion: "3" });
    expect(evidenceOf(call({ start_timestamp: undefined, agent_version: undefined }))).toMatchObject({ callStartMs: null, agentVersion: null });
    expect(evidenceOf(call({ start_timestamp: -1 })).callStartMs).toBeNull();
    expect(evidenceOf(call({ start_timestamp: 1.5 })).callStartMs).toBeNull();
    expect(evidenceOf(call({ agent_version: "v2" })).agentVersion).toBe("v2");
    expect(evidenceOf(call({ agent_version: { n: 1 } })).agentVersion).toBeNull();
  });

  it('agent_version 0 becomes "0"', () => {
    expect(evidenceOf(call({ agent_version: 0 })).agentVersion).toBe("0");
  });

  it("falls back to the scrubbed transcript when the plain one is absent", () => {
    const scrubbed = [{ role: "user", content: "My name is [person name 1].", words: [] }];
    const absent = fromRetell(call({ transcript_with_tool_calls: undefined, scrubbed_transcript_with_tool_calls: scrubbed }));
    expect(absent).toMatchObject({ kind: "evidence", source: "scrubbed_transcript_with_tool_calls" });
    const empty = fromRetell(call({ transcript_with_tool_calls: [], scrubbed_transcript_with_tool_calls: scrubbed }));
    expect(empty).toMatchObject({ kind: "evidence", source: "scrubbed_transcript_with_tool_calls" });
    expect(fromRetell(call({ scrubbed_transcript_with_tool_calls: scrubbed }))).toMatchObject({ kind: "evidence", source: "transcript_with_tool_calls" });
  });

  it("falls back to transcript_object with ordering none and a missing_tool_transcript gap", () => {
    const out = fromRetell(
      call({
        transcript_with_tool_calls: undefined,
        transcript_object: [
          { role: "agent", content: "Hi, this is Northwind Clinic.", words: [{ word: "Hi,", start: 0.5, end: 0.7 }] },
          { role: "user", content: "Book me with Dr. Amara Osei.", words: [] },
        ],
      }),
    );
    expect(out.kind === "evidence" && out.source).toBe("transcript_object");
    const e = evidenceOf(call({ transcript_with_tool_calls: undefined, transcript_object: [{ role: "user", content: "Hello", words: [] }] }));
    expect(e.ordering).toBe("none");
    expect(e.items).toEqual([{ kind: "turn", seq: 1, role: "caller", text: "Hello", startSec: null, interrupted: null }]);
    expect(e.gaps).toEqual([{ code: "missing_tool_transcript", detail: GAP_DETAIL.missing_tool_transcript, seqs: [] }]);
  });

  describe("reads no_content for a stripped call and for a call that never connected", () => {
    const none = { transcript_with_tool_calls: undefined };
    it.each<[string, Raw, Adapted]>([
      ["basic_attributes_only storage", { ...none, data_storage_setting: "basic_attributes_only" }, { kind: "no_content", callId: "call_jordan", reason: "storage_stripped" }],
      ["the older opt-out flag", { ...none, opt_out_sensitive_data_storage: true }, { kind: "no_content", callId: "call_jordan", reason: "storage_stripped" }],
      ["call_status not_connected", { ...none, call_status: "not_connected", disconnection_reason: undefined }, { kind: "no_content", callId: "call_jordan", reason: "never_connected" }],
      ["a dial failure", { ...none, call_type: "phone_call", disconnection_reason: "dial_no_answer" }, { kind: "no_content", callId: "call_jordan", reason: "never_connected" }],
      ["a web caller who never joined", { ...none, disconnection_reason: "error_user_not_joined" }, { kind: "no_content", callId: "call_jordan", reason: "never_connected" }],
      ["never connected on a stripped agent", { ...none, call_status: "not_connected", data_storage_setting: "basic_attributes_only" }, { kind: "no_content", callId: "call_jordan", reason: "never_connected" }],
      ["an ended call with no transcript field", none, { kind: "no_content", callId: "call_jordan", reason: "no_transcript" }],
      ["a call still ongoing", { ...none, call_status: "ongoing" }, { kind: "no_content", callId: "call_jordan", reason: "no_transcript" }],
      ["every transcript empty", { transcript_with_tool_calls: [], scrubbed_transcript_with_tool_calls: [], transcript_object: [] }, { kind: "no_content", callId: "call_jordan", reason: "no_transcript" }],
    ])("%s", (_name, over, expected) => {
      expect(fromRetell(call(over))).toEqual(expected);
    });

    it("gives only the reasons labels.ts has words for", () => {
      const reasons = new Set<string>(NO_CONTENT_REASONS);
      for (const over of [{ data_storage_setting: "basic_attributes_only" }, { call_status: "not_connected" }, {}]) {
        const out = fromRetell(call({ transcript_with_tool_calls: undefined, ...over }));
        expect(out.kind === "no_content" && reasons.has(out.reason)).toBe(true);
      }
    });
  });

  it("keeps placeholder text such as [person name 1] as is", () => {
    const e = evidenceOf(
      call({
        transcript_with_tool_calls: [
          { role: "user", content: "It's [person name 1], born [date_of_birth_1].", words: [] },
          { role: "tool_call_invocation", tool_call_id: "v", name: "verify_patient", arguments: '{"name":"[person name 1]"}' },
          { role: "tool_call_result", tool_call_id: "v", content: '{"verified":true}', successful: true },
        ],
      }),
    );
    expect(e.items[0]).toMatchObject({ text: "It's [person name 1], born [date_of_birth_1]." });
    expect(e.items[1]).toMatchObject({ args: { name: "[person name 1]" } });
  });

  it("tolerates unknown roles and non-JSON content", () => {
    const e = evidenceOf(
      call({
        transcript_with_tool_calls: [
          { role: "tool_call_invocation", tool_call_id: "o", name: "verify_patient", arguments: { name: "Casey Nguyen", dob: "1978-11-02" } },
          { role: "tool_call_result", tool_call_id: "o", content: "OK", successful: true },
          { role: "hologram", content: "beam me up" },
          { content: "no role at all" },
          "a bare string",
          null,
          { role: "tool_call_invocation", tool_call_id: "p", name: "check_availability", arguments: "not json {" },
          { role: "tool_call_invocation", tool_call_id: "q", name: "check_availability", arguments: "[1,2]" },
          { role: "tool_call_invocation", tool_call_id: "r", name: "check_availability" },
          { role: "agent", content: 42 },
        ],
      }),
    );
    expect(e.items[0]).toMatchObject({ kind: "tool_call", args: { name: "Casey Nguyen", dob: "1978-11-02" } });
    expect(e.items[1]).toMatchObject({ kind: "tool_result", payload: "OK" });
    expect(e.items[2]).toEqual({ kind: "event", seq: 3, type: "hologram", data: { content: "beam me up" } });
    expect(e.items[3]).toEqual({ kind: "event", seq: 4, type: "unknown", data: { content: "no role at all" } });
    expect(e.items[4]).toEqual({ kind: "event", seq: 5, type: "unknown", data: "a bare string" });
    expect(e.items[5]).toEqual({ kind: "event", seq: 6, type: "unknown", data: null });
    expect(ofKind(e, "tool_call").slice(1).map((c) => c.args)).toEqual([{}, {}, {}]);
    expect(e.items[9]).toEqual({ kind: "event", seq: 10, type: "agent", data: { content: 42 } });
  });

  it("parses JSON content of any shape and leaves other content as it came", () => {
    const results = [`"quoted"`, "42", "[1]", "", "  ", { already: "object" }];
    const e = evidenceOf(
      call({
        transcript_with_tool_calls: [
          { role: "tool_call_invocation", tool_call_id: "t", name: "lookup", arguments: "{}" },
          ...results.map((content) => ({ role: "tool_call_result", tool_call_id: "t", content })),
        ],
      }),
    );
    expect(ofKind(e, "tool_result").map((r) => r.payload)).toEqual(["quoted", 42, [1], "", "  ", { already: "object" }]);
  });

  it("an invocation with no id or name becomes an event", () => {
    const e = evidenceOf(
      call({
        transcript_with_tool_calls: [
          { role: "tool_call_invocation", name: "book_appointment", arguments: "{}" },
          { role: "tool_call_invocation", tool_call_id: "n", arguments: "{}" },
        ],
      }),
    );
    expect(e.items.map((it) => it.kind === "event" && it.type)).toEqual(["tool_call_invocation", "tool_call_invocation"]);
  });

  it("keeps streamed fragments as separate turns and never merges across a tool item", () => {
    const e = evidenceOf(toRetell(failedSample.evidence));
    const at = (seq: number) => e.items[seq - 1];
    expect([2, 3, 4].map((s) => at(s))).toEqual(failedSample.evidence.items.slice(1, 4));
    expect([5, 6, 7].map((s) => at(s).kind)).toEqual(["turn", "tool_call", "turn"]);
    expect(at(5)).toMatchObject({ role: "agent", text: "I can " });
    expect(at(7)).toMatchObject({ role: "agent", text: "help " });
    expect(e.items).toHaveLength(failedSample.evidence.items.length);
  });

  it("an orphan tool result becomes an event, not a tool_result", () => {
    const e = evidenceOf(
      call({
        transcript_with_tool_calls: [
          { role: "tool_call_result", tool_call_id: "ghost", content: '{"ok":true}', successful: true },
          { role: "tool_call_result", content: "no id" },
        ],
      }),
    );
    expect(e.items).toEqual([
      { kind: "event", seq: 1, type: "tool_call_result", data: { tool_call_id: "ghost", content: '{"ok":true}', successful: true } },
      { kind: "event", seq: 2, type: "tool_call_result", data: { content: "no id" } },
    ]);
  });

  it("pairs a result with its invocation by tool_call_id, wherever it sits", () => {
    const e = evidenceOf(
      call({
        transcript_with_tool_calls: [
          { role: "tool_call_invocation", tool_call_id: "x", name: "verify_patient", arguments: "{}" },
          { role: "tool_call_invocation", tool_call_id: "y", name: "check_availability", arguments: "{}" },
          { role: "tool_call_result", tool_call_id: "y", content: "{}", successful: true },
          { role: "tool_call_result", tool_call_id: "x", content: "{}", successful: false },
        ],
      }),
    );
    expect(ofKind(e, "tool_result").map((r) => [r.id, r.platformOk])).toEqual([
      ["y", true],
      ["x", false],
    ]);
  });

  it("a duplicate tool_call_id keeps the first invocation and turns the rest into events", () => {
    const e = evidenceOf(
      call({
        transcript_with_tool_calls: [
          { role: "tool_call_invocation", tool_call_id: "d", name: "book_appointment", arguments: '{"slotId":"s-1"}' },
          { role: "tool_call_invocation", tool_call_id: "d", name: "book_appointment", arguments: '{"slotId":"s-2"}' },
          { role: "tool_call_result", tool_call_id: "d", content: "{}", successful: true },
        ],
      }),
    );
    expect(e.items[0]).toMatchObject({ kind: "tool_call", args: { slotId: "s-1" } });
    expect(e.items[1]).toEqual({
      kind: "event",
      seq: 2,
      type: "tool_call_invocation",
      data: { tool_call_id: "d", name: "book_appointment", arguments: '{"slotId":"s-2"}' },
    });
    expect(e.items[2]).toMatchObject({ kind: "tool_result", id: "d" });
  });

  it("unwraps a saved webhook body and a custom-function body", () => {
    const inner = call();
    const plain = evidenceOf(inner);
    expect(evidenceOf({ event: "call_analyzed", call: inner })).toEqual(plain);
    expect(evidenceOf({ name: "book_appointment", args: { slotId: "s-1" }, call: inner })).toEqual(plain);
    expect(fromRetell({ event: "call_ended", call: call({ transcript_with_tool_calls: undefined, call_status: "not_connected" }) })).toEqual({
      kind: "no_content",
      callId: "call_jordan",
      reason: "never_connected",
    });
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "call_jordan"],
    ["a number", 7],
    ["an array of calls", [call()]],
    ["an object with no call_id", { call_status: "ended" }],
    ["an empty call_id", { call_id: "" }],
    ["a webhook body whose call has no call_id", { event: "call_ended", call: { call_status: "ended" } }],
  ])("throws an InputError with a fix for %s", (_name, raw) => {
    let thrown: unknown;
    try {
      fromRetell(raw);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(InputError);
    expect(thrown).toMatchObject({ message: NOT_A_RETELL_CALL.message, fix: NOT_A_RETELL_CALL.fix });
  });

  it.each<[string, Raw]>([
    ["a transcript that is a string", { transcript_with_tool_calls: "Agent: Hi" }],
    ["a transcript that is an object", { transcript_with_tool_calls: { 0: { role: "agent", content: "Hi" } } }],
    ["words that are not a list", { transcript_with_tool_calls: [{ role: "agent", content: "Hi", words: "Hi" }] }],
    ["a first word with no start", { transcript_with_tool_calls: [{ role: "user", content: "Hi", words: [{ word: "Hi" }, null] }] }],
    ["a null call_analysis", { call_analysis: null }],
    ["a transcript_object full of junk", { transcript_with_tool_calls: undefined, transcript_object: [null, 3, { role: "tool_call_invocation" }] }],
  ])("never throws on %s", (_name, over) => {
    const out = fromRetell(call(over));
    if (out.kind === "evidence") evidenceOf(call(over));
    else expect(out).toMatchObject({ kind: "no_content", callId: "call_jordan" });
  });

  describe("round trip: fromRetell(toRetell(sample.evidence)) equals sample.evidence except tool_result.ok", () => {
    it.each(SAMPLE_REPORTS.map((s) => [s.callId, s] as const))("%s", (_id, sample) => {
      const back = fromRetell(toRetell(sample.evidence));
      const expected: Evidence = {
        ...sample.evidence,
        items: sample.evidence.items.map((it) => (it.kind === "tool_result" ? { ...it, ok: null } : it)),
      };
      expect(back).toEqual({ kind: "evidence", source: "transcript_with_tool_calls", agentId: null, evidence: expected });
    });
  });
});
