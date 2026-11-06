// @vitest-environment node
// resolveOk: every tool result gets the success the evidence supports (spec 6.1), and never a guessed true. Calls
// here are made up with the seed's names, or are the three scrubbed samples.
import { describe, expect, it } from "vitest";
import { EvidenceSchema, PolicySchema, type Evidence, type Item, type Policy } from "@/report/schema";
import { SAMPLE_REPORTS } from "@/report/samples";
import { fromRetell } from "./adapters/retell";
import { ev, type ItemSpec } from "./testing/build";
import { toRetell } from "./testing/retell";
import preset from "./presets/northwind-clinic.json";
import { inferPolicy, policyFor } from "./policy";
import { unknownSuccessDetail } from "./wording";
import { resolveOk } from "./resolve-ok";

const PRESET: Policy = PolicySchema.parse(preset);

/** A tool call and its unsettled result, for ev(). */
function tool(id: string, name: string, payload: unknown, platformOk: boolean | null, args: Record<string, unknown> = {}): ItemSpec[] {
  return [
    { kind: "tool_call", id, name, args },
    { kind: "tool_result", id, ok: null, platformOk, payload },
  ];
}

/** The ok of each tool result, in order. */
function oks(e: Evidence): (boolean | null)[] {
  return e.items.flatMap((it) => (it.kind === "tool_result" ? [it.ok] : []));
}

/** One tool call and result under a policy: the settled ok and the gaps. */
function settle(name: string, payload: unknown, platformOk: boolean | null, policy: Policy = PRESET) {
  const out = resolveOk(ev(tool("tc_1", name, payload, platformOk)), policy);
  return { ok: oks(out)[0], gaps: out.gaps };
}

/** A policy with one tool and nothing else. */
function only(name: string, tp: Policy["tools"][string], extra: Partial<Policy> = {}): Policy {
  return { packs: ["scheduling"], tools: { [name]: tp }, fields: {}, ...extra };
}

/** The sample's evidence with every tool result's ok cleared, as the adapter hands it over. */
function unsettled(e: Evidence): Evidence {
  return { ...e, items: e.items.map((it): Item => (it.kind === "tool_result" ? { ...it, ok: null } : it)) };
}

describe("resolveOk: the payload path", () => {
  it("a payload path that resolves wins over platformOk true", () => {
    expect(settle("book_appointment", { ok: false, error: "not_verified" }, true)).toEqual({ ok: false, gaps: [] });
    expect(settle("book_appointment", { ok: true, appointmentId: "a-1" }, true)).toEqual({ ok: true, gaps: [] });
  });

  it("a tool's own success path overrides the top-level one", () => {
    // verify_patient reads result.verified; the top-level result.ok is not looked at.
    expect(settle("verify_patient", { verified: false, ok: true }, true).ok).toBe(false);
    expect(settle("verify_patient", { verified: true }, true).ok).toBe(true);
  });

  it("reads nested success paths and array indexes", () => {
    const nested = only("book_slot", { role: "change", kind: "book", success: "result.data.status.ok" });
    expect(settle("book_slot", { data: { status: { ok: false } } }, true, nested).ok).toBe(false);
    expect(settle("book_slot", { data: { status: { ok: true } } }, null, nested).ok).toBe(true);
    const indexed = only("book_slot", { role: "change", kind: "book", success: "result.results.0.ok" });
    expect(settle("book_slot", { results: [{ ok: false }, { ok: true }] }, true, indexed).ok).toBe(false);
  });

  it("reads success only from the result, never from what the agent sent", () => {
    const fromArgs = only("book_slot", { role: "change", kind: "book", success: "args.confirmed", items: "args.slots" });
    const out = resolveOk(ev(tool("tc_1", "book_slot", { status: "queued" }, null, { confirmed: true, slots: [] })), fromArgs);
    expect(oks(out)).toEqual([null]);
    const lookup = only("find_slots", { role: "lookup", items: "args.slots" });
    expect(oks(resolveOk(ev(tool("tc_1", "find_slots", "busy", null, { slots: [] })), lookup))).toEqual([null]);
  });

  it("a payload value that is not a boolean does not settle anything", () => {
    for (const ok of ["true", 1, "ok", null, {}]) {
      expect(settle("book_appointment", { ok }, true).ok).toBe(true); // platformOk true settles it
      const unknown = settle("book_appointment", { ok }, null);
      expect(unknown.ok).toBeNull();
      expect(unknown.gaps.map((g) => g.code)).toEqual(["unknown_success"]);
    }
  });
});

describe("resolveOk: the platform's success field", () => {
  it("platformOk false always wins", () => {
    expect(settle("book_appointment", { ok: true }, false)).toEqual({ ok: false, gaps: [] });
    expect(settle("check_availability", { slots: [] }, false)).toEqual({ ok: false, gaps: [] });
    expect(settle("unknown_tool", "OK", false)).toEqual({ ok: false, gaps: [] });
  });

  it("a 500 whose body says ok is a failure", () => {
    const out = settle("book_appointment", { ok: true, message: "HTTP 500 from upstream" }, false);
    expect(out).toEqual({ ok: false, gaps: [] });
  });

  it("platformOk true settles a result whose payload path does not resolve", () => {
    expect(settle("book_appointment", { appointmentId: "a-1" }, true)).toEqual({ ok: true, gaps: [] });
    expect(settle("unknown_tool", { anything: 1 }, true)).toEqual({ ok: true, gaps: [] });
  });

  it("with successful missing, the payload path still settles it", () => {
    expect(settle("book_appointment", { ok: true }, null)).toEqual({ ok: true, gaps: [] });
    expect(settle("book_appointment", { ok: false }, null)).toEqual({ ok: false, gaps: [] });
  });
});

describe("resolveOk: lookups", () => {
  it("a lookup is ok when its items path resolves to a list, even an empty one", () => {
    expect(settle("check_availability", { slots: [{ id: "s-1" }] }, null)).toEqual({ ok: true, gaps: [] });
    expect(settle("check_availability", { slots: [] }, null)).toEqual({ ok: true, gaps: [] });
  });

  it("a lookup ignores the top-level success path", () => {
    // The preset's top-level path is result.ok; a lookup answers with slots, so ok: false in its body is not read.
    expect(settle("check_availability", { ok: false, slots: [] }, null).ok).toBe(true);
  });

  it("a lookup's own success path comes before its items", () => {
    const policy = only("find_slots", { role: "lookup", items: "result.slots", success: "result.ok" });
    expect(settle("find_slots", { ok: false, slots: [] }, true, policy).ok).toBe(false);
  });

  it("a lookup whose items are missing or not a list falls back to platformOk", () => {
    expect(settle("check_availability", { slots: "none" }, true).ok).toBe(true);
    const unknown = settle("check_availability", { error: "busy" }, null);
    expect(unknown.ok).toBeNull();
    expect(unknown.gaps.map((g) => g.code)).toEqual(["unknown_success"]);
  });
});

describe("resolveOk: nothing to go on", () => {
  it("nothing available gives null and unknown_success, with the result's seq and the tool", () => {
    const out = resolveOk(ev([{ kind: "turn", role: "agent", text: "One moment.", startSec: null, interrupted: null }, ...tool("tc_1", "book_appointment", { appointmentId: "a-1" }, null)]), PRESET);
    expect(oks(out)).toEqual([null]);
    expect(out.gaps).toEqual([{ code: "unknown_success", detail: unknownSuccessDetail("book_appointment"), seqs: [3], tool: "book_appointment" }]);
  });

  it("a plain-text OK is never read as success", () => {
    const unknown = settle("book_appointment", "OK", null);
    expect(unknown.ok).toBeNull();
    expect(unknown.gaps.map((g) => g.code)).toEqual(["unknown_success"]);
    expect(settle("unknown_tool", "OK", null).ok).toBeNull();
    expect(settle("book_appointment", "OK", true).ok).toBe(true); // Retell said it worked
  });

  it("a tool the policy does not know uses the top-level path, then platformOk", () => {
    expect(settle("send_sms", { ok: false }, true).ok).toBe(false);
    expect(settle("send_sms", { sent: true }, null).ok).toBeNull();
  });

  it("an inferred policy with no success path gives null and a gap when Retell says nothing", () => {
    const call = ev(tool("tc_1", "lookup_order", { order: { id: "o-1" } }, null));
    const out = resolveOk(call, inferPolicy(call));
    expect(oks(out)).toEqual([null]);
    expect(out.gaps.map((g) => g.code)).toEqual(["unknown_success"]);
  });

  it("raises one gap per unsettled result, and none for a settled one", () => {
    const out = resolveOk(ev([...tool("tc_1", "book_appointment", "OK", null), ...tool("tc_2", "book_appointment", { ok: true }, null), ...tool("tc_3", "cancel_appointment", "done", null)]), PRESET);
    expect(oks(out)).toEqual([null, true, null]);
    expect(out.gaps.map((g) => [g.seqs, g.tool])).toEqual([
      [[2], "book_appointment"],
      [[6], "cancel_appointment"],
    ]);
  });
});

describe("resolveOk: the evidence it returns", () => {
  it("settles ok from the evidence alone, replacing any ok already set", () => {
    const call = ev(tool("tc_1", "book_appointment", "OK", null));
    const stale = { ...call, items: call.items.map((it): Item => (it.kind === "tool_result" ? { ...it, ok: true } : it)) };
    expect(oks(resolveOk(stale, PRESET))).toEqual([null]);
  });

  it("drops an unknown_success gap the evidence no longer supports", () => {
    const call = ev(tool("tc_1", "book_appointment", { ok: true }, null), {
      gaps: [{ code: "unknown_success", detail: "stale", seqs: [2], tool: "book_appointment" }],
    });
    expect(resolveOk(call, PRESET).gaps).toEqual([]);
  });

  it("keeps the gaps it was given, does not change its input, and gives the same evidence when run twice", () => {
    const given = { code: "missing_tool_transcript" as const, detail: "kept", seqs: [] };
    const call = ev(tool("tc_1", "book_appointment", "OK", null), { gaps: [given] });
    const before = structuredClone(call);
    const once = resolveOk(call, PRESET);
    expect(call).toEqual(before);
    expect(once.gaps[0]).toEqual(given);
    expect(resolveOk(once, PRESET)).toEqual(once);
    expect(EvidenceSchema.parse(once)).toEqual(once);
  });

  it("leaves every item that is not a tool result as it was", () => {
    const call = ev([{ kind: "turn", role: "caller", text: "Hi.", startSec: 1, interrupted: null }, ...tool("tc_1", "book_appointment", { ok: true }, true), { kind: "event", type: "transfer_target", data: {} }]);
    const out = resolveOk(call, PRESET);
    expect(out.items.filter((it) => it.kind !== "tool_result")).toEqual(call.items.filter((it) => it.kind !== "tool_result"));
  });
});

describe("resolveOk on the three samples", () => {
  it.each(SAMPLE_REPORTS.map((s) => [s.callId, s] as const))("%s: reproduces each tool result's ok and the sample's gaps", (_, sample) => {
    const { policy } = policyFor(sample.evidence);
    expect(resolveOk(unsettled(sample.evidence), policy)).toEqual(sample.evidence);
    expect(resolveOk(unsettled(sample.evidence), PRESET)).toEqual(sample.evidence);
  });

  it.each(SAMPLE_REPORTS.map((s) => [s.callId, s] as const))("%s: the whole Retell chain gives the sample's evidence", (_, sample) => {
    const adapted = fromRetell(toRetell(sample.evidence));
    if (adapted.kind !== "evidence") throw new Error("expected evidence");
    expect(resolveOk(adapted.evidence, policyFor(adapted.evidence).policy)).toEqual(sample.evidence);
  });
});
