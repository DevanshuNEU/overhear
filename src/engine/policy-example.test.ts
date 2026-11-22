// @vitest-environment node
// examples/livekit-clinic/policy.json against session reports shaped like the example agent's real tool output
// (examples/livekit-clinic/agent.py: open_slots items carry slot_id, date, time and provider), and what a call that uses
// a tool the policy does not name gets.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PolicySchema } from "@/report/schema";
import { analyzeRecord } from "./analyze";

const policy = PolicySchema.parse(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../examples/livekit-clinic/policy.json"), "utf8")));
const SLOTS = [
  { slot_id: "slot-1", date: "2026-12-03", time: "09:00", provider: "Dr. Lee" },
  { slot_id: "slot-2", date: "2026-12-03", time: "10:30", provider: "Dr. Lee" },
];

type Item = Record<string, unknown>;
const msg = (i: number, role: string, text: string, t: number): Item => ({ id: `item_${i}`, type: "message", role, content: [text], interrupted: false, extra: {}, metrics: {}, created_at: t });
const call = (i: number, id: string, name: string, args: unknown, t: number): Item => ({ id: `item_${i}/fnc_0`, type: "function_call", call_id: id, arguments: JSON.stringify(args), name, created_at: t });
const out = (i: number, id: string, name: string, payload: unknown, t: number): Item => ({ id: `item_${i}`, type: "function_call_output", name, call_id: id, output: JSON.stringify(payload), is_error: false, created_at: t });
const report = (job: string, items: Item[]) => ({ job_id: job, room_id: `RM_${job}`, chat_history: { items }, timestamp: 1795322080, sdk_version: "1.8.13", agent_name: "" });

const T = 1795322073;
function booking(spoken: string): unknown {
  return report("AJ_example_booking", [
    msg(1, "user", "Hi, I'm Maria Lopez. I'd like the 9 a.m. appointment on December 3rd.", T),
    call(2, "call_1", "check_availability", { date: "2026-12-03" }, T + 1),
    out(3, "call_1", "check_availability", { date: "2026-12-03", open_slots: SLOTS }, T + 1.2),
    call(4, "call_2", "book_appointment", { slot_id: "slot-1", patient_name: "Maria Lopez" }, T + 2),
    out(5, "call_2", "book_appointment", { status: "booked", slot_id: "slot-1", patient_name: "Maria Lopez", date: "2026-12-03", time: "09:00" }, T + 2.2),
    msg(6, "assistant", spoken, T + 3),
  ]);
}

function transfer(withTool: boolean): unknown {
  return report("AJ_example_transfer", [
    msg(1, "user", "Can I speak to a nurse about my knee?", T),
    ...(withTool ? [call(2, "call_1", "transfer_to_nurse", {}, T + 1), out(3, "call_1", "transfer_to_nurse", { transferred: true }, T + 1.2)] : []),
    msg(4, "assistant", "I'm transferring you to the nurse now. Please hold.", T + 2),
  ]);
}

const run = (raw: unknown, withPolicy = true) => {
  const o = analyzeRecord(raw, { tz: "UTC", ...(withPolicy ? { policy } : {}) });
  if (o.kind !== "report") throw new Error(`expected a report, got ${JSON.stringify(o)}`);
  return o.report;
};
const transferResult = (r: ReturnType<typeof run>) => r.results.find((x) => x.contract === "transfer_kept")?.result;

describe("the LiveKit clinic example policy", () => {
  it("reads a correct booking as Passed", () => {
    expect(run(booking("You're booked for Thursday, December 3rd at 9 a.m. with Dr. Lee.")).verdict).toBe("passed");
  });

  it("reads a wrong spoken date as Failed", () => {
    expect(run(booking("You're booked for Friday, December 4th at 9 a.m. with Dr. Lee.")).verdict).toBe("failed");
  });
});

describe("a policy that does not name every tool the call used", () => {
  it("a promised transfer with no transfer tool reads Failed when the policy names every tool the call used", () => {
    expect(transferResult(run(transfer(false)))).toBe("violated");
  });

  it("a transfer tool the policy does not name, run just before the claim, is not Failed", () => {
    const r = run(transfer(true));
    expect(r.verdict).not.toBe("failed");
    expect(transferResult(r)).not.toBe("violated");
  });

  it("uses the policy's tools and fields for that call all the same", () => {
    expect(run(booking("You're booked for Thursday, December 3rd at 9 a.m. with Dr. Lee.")).policy).toEqual(policy);
  });
});
