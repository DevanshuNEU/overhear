// @vitest-environment node
// The LiveKit adapter: the JSON of SessionReport.to_dict() in, evidence or a plain no_content out. Records are made up
// in the shape docs/research/livekit-facts.md describes; the real library output is covered by the eval cases.
import { describe, expect, it } from "vitest";
import { LIVEKIT_NO_CALL_ID, NOT_A_LIVEKIT_REPORT } from "@/report/labels";
import { EvidenceSchema, type Item } from "@/report/schema";
import { InputError } from "../types";
import { fromLiveKit, isLiveKitReport, type Adapted } from "./livekit";

type Raw = Record<string, unknown>;
type Turn = Extract<Item, { kind: "turn" }>;
type EventItem = Extract<Item, { kind: "event" }>;
const T0 = 1795322000;

const msg = (role: string, text: unknown[], over: Raw = {}): Raw => ({ id: "m", type: "message", role, content: text, interrupted: false, metrics: {}, created_at: T0 + 1, ...over });

function report(items: Raw[], over: Raw = {}): Raw {
  return { job_id: "AJ_1", room_id: "RM_1", room: "room-1", timestamp: T0 + 10, duration_ms: 10000, sdk_version: "1.8.13", agent_name: "", close_reason: "CR_USER_INITIATED", chat_history: { items }, ...over };
}

function adapt(raw: unknown): Extract<Adapted, { kind: "evidence" }> {
  const out = fromLiveKit(raw);
  if (out.kind !== "evidence") throw new Error(`expected evidence, got ${out.kind}`);
  expect(() => EvidenceSchema.parse(out.evidence)).not.toThrow();
  return out;
}
const items = (raw: unknown): Item[] => adapt(raw).evidence.items;

describe("recognising a LiveKit report", () => {
  it("needs chat_history.items and one of job_id, room_id, sdk_version", () => {
    expect(isLiveKitReport(report([]))).toBe(true);
    expect(isLiveKitReport({ sdk_version: "1", chat_history: { items: [] } })).toBe(true);
    expect(isLiveKitReport({ chat_history: { items: [] } })).toBe(false);
    expect(isLiveKitReport({ job_id: "x", chat_history: { items: {} } })).toBe(false);
    expect(isLiveKitReport({ job_id: "x" })).toBe(false);
    for (const v of [null, undefined, 1, "s", []]) expect(isLiveKitReport(v)).toBe(false);
  });

  it("throws a plain InputError for anything else", () => {
    for (const raw of [null, {}, { job_id: "x" }, { chat_history: { items: [] } }]) {
      expect(() => fromLiveKit(raw)).toThrow(InputError);
    }
    expect(() => fromLiveKit({})).toThrow(expect.objectContaining({ message: NOT_A_LIVEKIT_REPORT.message, fix: NOT_A_LIVEKIT_REPORT.fix }));
  });

  it("needs a non-empty call id: job_id, else room_id, else room", () => {
    expect(adapt(report([msg("user", ["hi"])])).evidence.callId).toBe("AJ_1");
    expect(adapt(report([msg("user", ["hi"])], { job_id: "" })).evidence.callId).toBe("RM_1");
    expect(adapt(report([msg("user", ["hi"])], { job_id: undefined, room_id: "", room: "room-1" })).evidence.callId).toBe("room-1");
    expect(() => fromLiveKit(report([], { job_id: "", room_id: "", room: "", sdk_version: "1" }))).toThrow(expect.objectContaining({ message: LIVEKIT_NO_CALL_ID.message }));
  });
});

describe("items", () => {
  it("turns messages into turns, numbered from 1 in history order, joining string parts", () => {
    const out = items(report([msg("user", ["Hi", { type: "image" }, "there"]), msg("assistant", ["Hello."], { interrupted: true }), msg("assistant", ["x"], { interrupted: undefined })]));
    expect(out).toEqual([
      { kind: "turn", seq: 1, role: "caller", text: "Hi there", startSec: 1, interrupted: false },
      { kind: "turn", seq: 2, role: "agent", text: "Hello.", startSec: 1, interrupted: true },
      { kind: "turn", seq: 3, role: "agent", text: "x", startSec: 1, interrupted: null },
    ]);
  });

  it("takes startSec from started_speaking_at, else created_at, minus the call start, never negative", () => {
    const raw = report([msg("assistant", ["a"], { metrics: { started_speaking_at: T0 + 3.5 } }), msg("user", ["b"], { created_at: T0 - 5 })]);
    const out = items(raw) as Turn[];
    // The call starts at the earlier of timestamp - duration and the first item. The first item is at T0 + 1.
    expect(out[0].startSec).toBeCloseTo(3.5);
    expect(out[1].startSec).toBe(0);
  });

  it("turns system and developer messages into events", () => {
    const out = items(report([msg("user", ["hi"]), msg("system", ["be nice"]), msg("developer", ["x"])]));
    expect(out[1]).toMatchObject({ kind: "event", seq: 2, type: "message" });
    expect(out[2]).toMatchObject({ kind: "event", seq: 3, type: "message" });
  });

  it("pairs a function_call with its output by call_id, parsing arguments and output", () => {
    const out = items(
      report([
        msg("user", ["book"]),
        { id: "f/1", type: "function_call", call_id: "c1", name: "book_appointment", arguments: '{"date":"2026-12-03"}', created_at: T0 + 2 },
        { id: "o1", type: "function_call_output", call_id: "c1", name: "book_appointment", output: '{"ok":true}', is_error: false, created_at: T0 + 3 },
        { id: "f/2", type: "function_call", call_id: "c2", name: "x", arguments: "[1]", created_at: T0 + 4 },
        { id: "o2", type: "function_call_output", call_id: "c2", output: "Slot taken", is_error: true, created_at: T0 + 5 },
        { id: "o3", type: "function_call_output", call_id: "c2", output: "plain", created_at: T0 + 6 },
      ]),
    );
    expect(out[1]).toEqual({ kind: "tool_call", seq: 2, id: "c1", name: "book_appointment", args: { date: "2026-12-03" } });
    expect(out[2]).toEqual({ kind: "tool_result", seq: 3, id: "c1", ok: null, platformOk: true, payload: { ok: true } });
    expect(out[3]).toMatchObject({ kind: "tool_call", args: {} });
    expect(out[4]).toEqual({ kind: "tool_result", seq: 5, id: "c2", ok: null, platformOk: false, payload: "Slot taken" });
    expect(out[5]).toMatchObject({ kind: "tool_result", platformOk: null, payload: "plain" });
  });

  it("makes an output that names no tool call an event", () => {
    const out = items(report([msg("user", ["hi"]), { id: "o", type: "function_call_output", call_id: "nope", output: "x", is_error: false, created_at: T0 }]));
    expect(out[1]).toMatchObject({ kind: "event", type: "function_call_output" });
  });

  it("keeps every other type as an event, cutting long instructions to 500 characters and an ellipsis", () => {
    const long = "p".repeat(900);
    const out = items(
      report([
        { id: "h", type: "agent_handoff", new_agent_id: "default_agent", created_at: T0 },
        { id: "c", type: "agent_config_update", instructions: long, tools_added: ["a"], created_at: T0 },
        { id: "c2", type: "agent_config_update", instructions: "short", created_at: T0 },
        { id: "u", type: "something_new", created_at: T0 },
        msg("user", ["hi"]),
      ]),
    );
    expect(out[0]).toMatchObject({ kind: "event", seq: 1, type: "agent_handoff", data: { new_agent_id: "default_agent" } });
    const data = (out[1] as EventItem).data as Raw;
    expect(data.instructions).toBe("p".repeat(500) + "…");
    expect(data.tools_added).toEqual(["a"]);
    expect(((out[2] as EventItem).data as Raw).instructions).toBe("short");
    expect(out[3]).toMatchObject({ kind: "event", type: "something_new" });
    expect(out).toHaveLength(5);
  });
});

describe("call start, timestamps and fields", () => {
  it("starts at timestamp - duration, or the first item when that is earlier", () => {
    expect(adapt(report([msg("user", ["hi"])])).evidence.callStartMs).toBe(T0 * 1000);
    expect(adapt(report([msg("user", ["hi"], { created_at: T0 - 2 })])).evidence.callStartMs).toBe((T0 - 2) * 1000);
    expect(adapt(report([msg("user", ["hi"], { created_at: T0 + 4 })], { duration_ms: undefined })).evidence.callStartMs).toBe((T0 + 4) * 1000);
  });

  it("reads millisecond timestamps (Node SDK): above 1e12 is milliseconds", () => {
    const ms = (s: number) => s * 1000;
    const raw = report([msg("user", ["hi"], { created_at: ms(T0 + 1), metrics: { started_speaking_at: ms(T0 + 2) } })], { timestamp: ms(T0 + 10) });
    const a = adapt(raw);
    expect(a.evidence.callStartMs).toBe(T0 * 1000);
    expect((a.evidence.items[0] as Turn).startSec).toBeCloseTo(2);
  });

  it("has no start when nothing is timed", () => {
    const raw = report([{ id: "m", type: "message", role: "user", content: ["hi"] }], { timestamp: undefined, duration_ms: undefined });
    const a = adapt(raw);
    expect(a.evidence.callStartMs).toBeNull();
    expect(a.evidence.items[0]).toMatchObject({ startSec: null });
  });

  it("has tier 1, sequence ordering, platform livekit and a null agent version", () => {
    const e = adapt(report([msg("user", ["hi"])])).evidence;
    expect(e).toMatchObject({ platform: "livekit", tier: 1, ordering: "sequence", agentVersion: null });
  });

  it("maps the close reason into Retell's words, in one table", () => {
    const reason = (close_reason: unknown) => adapt(report([msg("user", ["hi"])], { close_reason })).evidence.callFields.disconnection_reason;
    expect(reason("CR_PARTICIPANT_DISCONNECTED")).toBe("user_hangup");
    expect(reason("participant_disconnected")).toBe("user_hangup");
    expect(reason("CR_USER_INITIATED")).toBe("agent_hangup");
    expect(reason("user_initiated")).toBe("agent_hangup");
    expect(reason("CR_TASK_COMPLETED")).toBe("agent_hangup");
    expect(reason("CR_COMPLETED")).toBe("agent_hangup");
    expect(reason("task_completed")).toBe("agent_hangup");
    expect(reason("CR_ERROR")).toBe("error_livekit");
    expect(reason("error")).toBe("error_livekit");
    expect(reason("CR_JOB_SHUTDOWN")).toBe("cr_job_shutdown");
    expect(reason(null)).toBeUndefined();
    expect(reason(undefined)).toBeUndefined();
  });

  it("carries duration_ms and call_type livekit_session", () => {
    expect(adapt(report([msg("user", ["hi"])])).evidence.callFields).toMatchObject({ duration_ms: 10000, call_type: "livekit_session" });
    expect(adapt(report([msg("user", ["hi"])], { duration_ms: null })).evidence.callFields.duration_ms).toBeUndefined();
  });

  it("gives the agent id for policy selection from agent_name, else null", () => {
    expect(adapt(report([msg("user", ["hi"])], { agent_name: "clinic" })).agentId).toBe("clinic");
    expect(adapt(report([msg("user", ["hi"])], { agent_name: "" })).agentId).toBeNull();
  });
});

describe("message text", () => {
  it("strips expressive markup from assistant text only, keeping the enclosed words", () => {
    const out = items(
      report([
        msg("user", ['Is it <expr type="x"/>booked?']),
        msg("assistant", ['You\'re <expr type="emotion" label="happy"/>booked. <expr style="slow">Thanks</expr> a lot.']),
      ]),
    ) as Turn[];
    expect(out[0].text).toBe('Is it <expr type="x"/>booked?');
    expect(out[1].text).toBe("You're booked. Thanks a lot.");
  });
});

describe("gaps and no content", () => {
  it("is no_content when no message has readable text, such as messages whose content LiveKit dropped", () => {
    const empty = report([msg("user", []), msg("assistant", ["  ", { type: "audio" }]), msg("assistant", ['<expr type="x"/>'])]);
    expect(fromLiveKit(empty)).toEqual({ kind: "no_content", callId: "AJ_1", reason: "no_transcript" });
  });

  it("keeps a report where at least one message has text, with its empty messages", () => {
    const out = items(report([msg("user", []), msg("assistant", ["Hello", { type: "image" }])]));
    expect(out).toHaveLength(2);
  });

  it("has no gaps: an empty tool list in a LiveKit history means no tool was called", () => {
    expect(adapt(report([msg("user", ["hi"]), msg("assistant", ["hello"])])).evidence.gaps).toEqual([]);
  });

  it("is no_content with no_transcript for an empty history or one with no message", () => {
    expect(fromLiveKit(report([]))).toEqual({ kind: "no_content", callId: "AJ_1", reason: "no_transcript" });
    expect(fromLiveKit(report([{ id: "h", type: "agent_handoff", new_agent_id: "a", created_at: T0 }]))).toEqual({ kind: "no_content", callId: "AJ_1", reason: "no_transcript" });
  });
});
