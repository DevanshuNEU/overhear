// @vitest-environment node
// The one rule that pairs a tool result with its call: the nearest earlier call with the result's id that no result
// has answered yet. resolveOk and toolCalls both use it, so they can never disagree about which call a result is for.
import { describe, expect, it } from "vitest";
import { PolicySchema, type Item, type Policy } from "@/report/schema";
import { ev, type ItemSpec } from "./testing/build";
import preset from "./presets/northwind-clinic.json";
import { pairToolItems } from "./pairing";
import { resolveOk } from "./resolve-ok";
import { changes, successfulChanges, toolCalls } from "./committed";

const PRESET: Policy = PolicySchema.parse(preset);
const call = (id: string, name: string, args: Record<string, unknown> = {}): ItemSpec => ({ kind: "tool_call", id, name, args });
const result = (id: string, payload: unknown, platformOk: boolean | null = true): ItemSpec => ({ kind: "tool_result", id, ok: null, platformOk, payload });
const okOf = (items: Item[]) => items.flatMap((i) => (i.kind === "tool_result" ? [i.ok] : []));

/** The [callSeq, resultSeq] pairs, calls in order; null for a call no result answered. */
function pairs(items: ItemSpec[]): [number, number | null][] {
  const p = pairToolItems(ev(items).items);
  return p.calls.map((c) => [c.seq, p.resultOf(c)?.seq ?? null]);
}

describe("pairToolItems", () => {
  it("pairs a result with the call that has its id", () => {
    expect(pairs([call("a", "x"), result("a", {})])).toEqual([[1, 2]]);
  });

  it("a reused id pairs each result with the call before it", () => {
    expect(pairs([call("t", "x"), result("t", {}), call("t", "y"), result("t", {})])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("two calls with one id in flight: each result answers one call, the nearest unanswered first", () => {
    expect(pairs([call("t", "x"), call("t", "x"), result("t", {}), result("t", {})])).toEqual([
      [1, 4],
      [2, 3],
    ]);
  });

  it("a result with no earlier call with its id is unpaired", () => {
    const p = pairToolItems(ev([result("ghost", {}), call("ghost", "x"), result("other", {})]).items);
    expect(p.results.map((r) => p.callOf(r)?.seq)).toEqual([undefined, undefined]);
    expect(p.calls.map((c) => p.resultOf(c)?.seq)).toEqual([undefined]);
  });

  it("a second result for an answered call is unpaired", () => {
    const p = pairToolItems(ev([call("a", "x"), result("a", {}), result("a", {})]).items);
    expect(p.results.map((r) => p.callOf(r)?.seq)).toEqual([1, undefined]);
  });

  it("results out of order pair by id", () => {
    expect(pairs([call("a", "x"), call("b", "y"), result("b", {}), result("a", {})])).toEqual([
      [1, 4],
      [2, 3],
    ]);
  });
});

describe("one rule in resolveOk and toolCalls", () => {
  it("a reused id: the failed booking is judged by the booking's rules, not the lookup's", () => {
    const e = resolveOk(
      ev([
        call("tc_1", "check_availability"),
        result("tc_1", { slots: [{ id: "s-1", startsAt: "2026-11-06T09:00:00Z", providerName: "Dr. Nair" }] }),
        call("tc_1", "book_appointment", { slotId: "s-1" }),
        result("tc_1", { ok: false, error: "slot taken" }),
      ]),
      PRESET,
    );
    expect(okOf(e.items)).toEqual([true, false]);
    expect(changes(e, PRESET)[0].ok).toBe(false);
    expect(successfulChanges(changes(e, PRESET))).toEqual([]);
  });

  it("two calls with one id in flight get the same pairing from both", () => {
    const e = resolveOk(
      ev([
        call("t", "book_appointment", { slotId: "s-1" }),
        call("t", "book_appointment", { slotId: "s-2" }),
        result("t", { ok: true }),
        result("t", { ok: false }),
      ]),
      PRESET,
    );
    expect(toolCalls(e, PRESET, "change").map((u) => [u.callSeq, u.resultSeq, u.ok])).toEqual([
      [1, 4, false],
      [2, 3, true],
    ]);
  });

  it("results out of order keep each call's own ok", () => {
    const e = resolveOk(
      ev([call("a", "book_appointment", { slotId: "s-1" }), call("b", "cancel_appointment", { appointmentId: "x" }), result("b", { ok: true }), result("a", { ok: false })]),
      PRESET,
    );
    expect(toolCalls(e, PRESET, "change").map((u) => [u.toolCallId, u.resultSeq, u.ok])).toEqual([
      ["a", 4, false],
      ["b", 3, true],
    ]);
  });

  it("a result with no matching call still resolves, by the policy's default success path", () => {
    const e = resolveOk(ev([result("ghost", { ok: false })]), PRESET);
    expect(okOf(e.items)).toEqual([false]);
  });
});
