// @vitest-environment node
// verified_before_change: a booking, cancel or reschedule that worked needs an identity check that worked before it,
// when the agent is known to verify. Each case runs the real pieces (resolveOk, changes) and checks the finding text.
import { describe, expect, it } from "vitest";
import { PolicySchema, type Policy } from "@/report/schema";
import { changes, providerNames } from "../committed";
import { detectAll } from "../detect-speech";
import preset from "../presets/northwind-clinic.json";
import { resolveOk } from "../resolve-ok";
import { ev, type ItemSpec } from "../testing/build";
import type { ContractContext } from "./common";
import { verifiedBeforeChange } from "./verified-before-change";

const PRESET: Policy = PolicySchema.parse(preset);
const agent = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "agent", text, startSec, interrupted: null });
const tool = (id: string, name: string, args: Record<string, unknown>, payload: unknown, platformOk: boolean | null = true): ItemSpec[] => [
  { kind: "tool_call", id, name, args },
  { kind: "tool_result", id, ok: null, platformOk, payload },
];
const verify = (id = "tc_v", ok = true): ItemSpec[] => tool(id, "verify_patient", { name: "Jordan Ellis" }, ok ? { verified: true, patientId: "p1" } : { verified: false }, true);
const book = (id = "tc_b"): ItemSpec[] => tool(id, "book_appointment", { slotId: "s1", patientId: "p1" }, { ok: true });
const cancel = (): ItemSpec[] => tool("tc_c", "cancel_appointment", { appointmentId: "a1" }, { ok: true });

function run(items: ItemSpec[], policy: Policy = PRESET, policySource: "preset" | "inferred" = "preset", over = {}, policyByShape = false) {
  const evidence = resolveOk(ev(items, over), policy);
  const ctx: ContractContext = {
    ev: evidence,
    policy,
    policySource,
    policyByShape,
    tz: "UTC",
    policyTz: true,
    detections: detectAll(evidence, Object.keys(policy.tools)),
    changes: changes(evidence, policy),
    providerNames: providerNames(evidence, policy),
  };
  return verifiedBeforeChange(ctx);
}

describe("verified_before_change", () => {
  it("is not applicable when nothing was changed", () => {
    expect(run([...verify(), agent("Anything else?", 9)])).toEqual({ contract: "verified_before_change", result: "not_applicable", findings: [] });
  });

  it("passes when a check worked before the change, citing both", () => {
    const out = run([agent("One moment.", 3), ...verify(), ...book(), agent("Booked.", 20)]);
    expect(out.result).toBe("passed");
    expect(out.findings[0]).toMatchObject({ result: "passed", did: [2, 3, 4, 5], text: "The booking at 0:03 came after a successful identity check for the same patient." });
  });

  it("a failed check followed by a good one passes", () => {
    expect(run([...verify("tc_v1", false), ...verify("tc_v2"), ...book()]).result).toBe("passed");
  });

  it("is violated on a preset that names a check when none worked before the change, naming the time", () => {
    const out = run([agent("Booking.", 12), ...book()]);
    expect(out.result).toBe("violated");
    expect(out.findings[0].text).toBe("At 0:12 the agent booked before verifying who was calling.");
  });

  it("a check that failed, or came only after the change, is no check", () => {
    expect(run([...verify("tc_v", false), ...book()]).result).toBe("violated");
    expect(run([...book(), ...verify()]).result).toBe("violated");
  });

  it("says cancelled for a cancellation", () => {
    expect(run([agent("Cancelling.", 5), ...cancel()]).findings[0].text).toBe("At 0:05 the agent cancelled before verifying who was calling.");
  });

  it("a change that failed, or an update, needs no check", () => {
    expect(run(tool("tc_b", "book_appointment", { slotId: "s1" }, { ok: false }, false)).findings).toEqual([]);
    const update = PolicySchema.parse({ ...preset, tools: { ...preset.tools, update_details: { role: "change", kind: "update" } } });
    expect(run(tool("tc_u", "update_details", {}, { ok: true }), update).findings).toEqual([]);
  });

  describe("a preset picked by the call's shape", () => {
    it("is a guess, so a booking with no check is not violated and, with none used, not applicable", () => {
      expect(run([agent("Booking.", 12), ...book()], PRESET, "preset", {}, true)).toEqual({ contract: "verified_before_change", result: "not_applicable", findings: [] });
    });

    it("a check that ran only after the change is unverified, never violated", () => {
      expect(run([...book(), ...verify()], PRESET, "preset", {}, true).result).toBe("unverified");
    });

    it("a check that worked first still passes", () => {
      expect(run([...verify(), ...book()], PRESET, "preset", {}, true).result).toBe("passed");
    });
  });

  describe("an inferred policy", () => {
    const INFERRED = PolicySchema.parse({ packs: ["scheduling"], tools: { book_appointment: { role: "change", kind: "book" } }, fields: {} });
    const WITH_VERIFY = PolicySchema.parse({ packs: ["scheduling"], tools: { ...INFERRED.tools, verify_patient: { role: "verify" } }, fields: {} });

    it("is not applicable when it names no check and the call used none: nothing shows the agent should verify", () => {
      expect(run(book(), INFERRED, "inferred")).toEqual({ contract: "verified_before_change", result: "not_applicable", findings: [] });
    });

    it("passes when the call used a check before the change", () => {
      expect(run([...verify(), ...book()], WITH_VERIFY, "inferred").result).toBe("passed");
    });

    it("is unverified, never violated, when the check came only after the change", () => {
      const out = run([...book(), ...verify()], WITH_VERIFY, "inferred");
      expect(out.result).toBe("unverified");
      expect(out.findings[0].text).toMatch(/^Couldn't check the identity check: the identity check didn't succeed before the change/);
    });

    it("is unverified when a tool the policy doesn't describe ran first: it might have been the check", () => {
      const out = run([...tool("tc_x", "who_is_this", {}, { ok: true }), ...book(), ...verify()], WITH_VERIFY, "inferred");
      expect(out.result).toBe("unverified");
      expect(out.findings[0].text).toContain("who_is_this, which the policy doesn't describe");
    });
  });

  it("a check whose result doesn't say whether it worked is unverified", () => {
    const out = run([...tool("tc_v", "verify_patient", {}, { note: "pending" }, null), ...book()]);
    expect(out.result).toBe("unverified");
  });

  it("with ordering none nothing is before anything, so it is unverified", () => {
    expect(run([...book(), ...verify()], PRESET, "preset", { ordering: "none" }).result).toBe("unverified");
  });
});
