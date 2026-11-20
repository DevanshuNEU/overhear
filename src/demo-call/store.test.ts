import { beforeEach, describe, expect, it, vi } from "vitest";
import caseJson from "../../eval/engine/cases/mut-transfer-claim-caller-kept-asking-then-left.json";

vi.mock("@/lib/env", () => ({ env: { RETELL_API_KEY: "key_test_secret", RETELL_AGENT_ID: "agent_demo" } }));

import { EMPTY_TRANSCRIPT_GRACE_MS, RESULT_TIMEOUT_MS } from "@/pull/test-call";
import { cachedDemoReport, demoCallResult, MAX_READY, MIN_ASK_MS, READY_TTL_MS, resetDemoCalls } from "./store";

const base = { ...caseJson.record, agent_id: "agent_demo" };
const rec = (id: string, extra: Record<string, unknown> = {}) => ({ ...base, call_id: id, ...extra });
let clock = 1_000_000;
const deps = (getCall: (key: string, id: string) => Promise<unknown>) => ({ getCall, now: () => clock });

beforeEach(() => {
  clock = 1_000_000;
  resetDemoCalls();
});

describe("demoCallResult", () => {
  it("is ready with the engine's row, and keeps the report", async () => {
    const getCall = vi.fn(async () => rec("call_a"));
    const answer = await demoCallResult("call_a", deps(getCall));
    expect(answer).toMatchObject({ ok: true, result: { status: "ready", row: { callId: "call_a", state: "report", verdict: "failed" } } });
    expect(cachedDemoReport("call_a", clock)?.callId).toBe("call_a");
  });

  it("never asks Retell for a call it already has an outcome for", async () => {
    const getCall = vi.fn(async () => rec("call_a"));
    await demoCallResult("call_a", deps(getCall));
    clock += 10 * MIN_ASK_MS;
    await demoCallResult("call_a", deps(getCall));
    expect(getCall).toHaveBeenCalledTimes(1);
  });

  it("asks Retell at most once every 2 seconds for one call, and answers the last answer in between", async () => {
    const getCall = vi.fn(async () => rec("call_b", { call_status: "ongoing" }));
    expect(await demoCallResult("call_b", deps(getCall))).toEqual({ ok: true, result: { status: "processing" } });
    clock += MIN_ASK_MS - 1;
    expect(await demoCallResult("call_b", deps(getCall))).toEqual({ ok: true, result: { status: "processing" } });
    expect(getCall).toHaveBeenCalledTimes(1);
    clock += 1;
    await demoCallResult("call_b", deps(getCall));
    expect(getCall).toHaveBeenCalledTimes(2);
  });

  it("shares one request between asks that arrive together", async () => {
    const getCall = vi.fn(async () => rec("call_c", { call_status: "ongoing" }));
    await Promise.all([demoCallResult("call_c", deps(getCall)), demoCallResult("call_c", deps(getCall))]);
    expect(getCall).toHaveBeenCalledTimes(1);
  });

  it("is processing while an ended call has no transcript yet, then times out", async () => {
    const getCall = vi.fn(async () => rec("call_d", { transcript_with_tool_calls: undefined }));
    expect(await demoCallResult("call_d", deps(getCall))).toEqual({ ok: true, result: { status: "processing" } });
    clock += RESULT_TIMEOUT_MS - 1;
    expect(await demoCallResult("call_d", deps(getCall))).toEqual({ ok: true, result: { status: "processing" } });
    clock += MIN_ASK_MS;
    expect(await demoCallResult("call_d", deps(getCall))).toEqual({ ok: true, result: { status: "timeout" } });
  });

  it("reads an empty transcript as it is once the grace has passed", async () => {
    const getCall = vi.fn(async () => rec("call_e", { transcript_with_tool_calls: [] }));
    expect(await demoCallResult("call_e", deps(getCall))).toEqual({ ok: true, result: { status: "processing" } });
    clock += EMPTY_TRANSCRIPT_GRACE_MS;
    const answer = await demoCallResult("call_e", deps(getCall));
    expect(answer).toMatchObject({ ok: true, result: { status: "ready", row: { state: "no_content" } } });
  });

  it("answers not found for another agent's call and for a call Retell does not have", async () => {
    expect(await demoCallResult("call_f", deps(async () => rec("call_f", { agent_id: "agent_other" })))).toEqual({ ok: false, code: "not_found" });
    expect(await demoCallResult("call_g", deps(async () => Promise.reject(Object.assign(new Error("x"), { status: 404 }))))).toEqual({ ok: false, code: "not_found" });
  });

  it("answers not found for a record of a different call", async () => {
    expect(await demoCallResult("call_h", deps(async () => rec("call_other")))).toEqual({ ok: false, code: "unreadable" });
  });

  it("keeps at most 50 outcomes, the oldest going first", async () => {
    const getCall = async (_k: string, id: string) => rec(id);
    for (let i = 0; i < MAX_READY + 1; i++) await demoCallResult(`call_n${i}`, deps(getCall));
    expect(cachedDemoReport("call_n0", clock)).toBeUndefined();
    expect(cachedDemoReport("call_n1", clock)).toBeDefined();
    expect(cachedDemoReport(`call_n${MAX_READY}`, clock)).toBeDefined();
  });

  it("forgets an outcome after an hour", async () => {
    await demoCallResult("call_i", deps(async () => rec("call_i")));
    expect(cachedDemoReport("call_i", clock + READY_TTL_MS)).toBeDefined();
    expect(cachedDemoReport("call_i", clock + READY_TTL_MS + 1)).toBeUndefined();
  });

  it("never keeps an outcome that holds the key", async () => {
    const leaky = rec("call_j", { transcript_with_tool_calls: [{ role: "agent", content: "the key is key_test_secret", words: [], metadata: {}, utterance_id: "u1" }] });
    const answer = await demoCallResult("call_j", deps(async () => leaky));
    expect(JSON.stringify(answer)).not.toContain("key_test_secret");
    expect(cachedDemoReport("call_j", clock)).toBeUndefined();
  });
});
