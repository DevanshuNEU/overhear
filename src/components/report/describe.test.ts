import { describe, expect, it } from "vitest";
import { failedSample, needsReviewSample } from "@/report/samples";
import type { Evidence } from "@/report/schema";
import { resultBeforeCall } from "@/report/samples/variants.fixture";
import { describeActions } from "./describe";

describe("describeActions", () => {
  it("makes one line of a tool call and its result", () => {
    const e = failedSample.evidence;
    const entries = describeActions(e, [22, 24]);
    expect(entries).toHaveLength(1);
    expect(entries[0].line).toBe("book_appointment succeeded");
    expect(entries[0].seqs).toEqual([22, 24]);
    expect(entries[0].raw).toMatchObject({ call: expect.any(Object), result: expect.any(Object) });
  });

  it("is the same line whichever half a finding cites", () => {
    const e = needsReviewSample.evidence;
    expect(describeActions(e, [7]).map((x) => x.line)).toEqual(["check_availability failed"]);
    expect(describeActions(e, [9]).map((x) => x.line)).toEqual(["check_availability failed"]);
    expect(describeActions(e, [7, 9])).toHaveLength(1);
  });

  it("keeps calls in the order the call made them", () => {
    const lines = describeActions(failedSample.evidence, [22, 24, 6, 8]).map((x) => x.line);
    expect(lines).toEqual(["check_availability succeeded", "book_appointment succeeded"]);
  });

  it("says when a call got no result", () => {
    const e: Evidence = { ...failedSample.evidence, items: [{ kind: "tool_call", seq: 1, id: "t", name: "check_availability", args: {} }] };
    expect(describeActions(e, [1])[0].line).toBe("check_availability was called, no result came back");
  });

  it("leaves backend actions and events as their own lines, and turns out", () => {
    const e: Evidence = {
      ...failedSample.evidence,
      tier: 2,
      items: [
        { kind: "turn", seq: 1, role: "agent", text: "x", startSec: 1, interrupted: null },
        { kind: "backend_action", seq: 2, id: "a", toolCallId: null, tool: "book_appointment", args: {}, result: { ok: true }, ok: true, ts: "t", link: null },
        { kind: "event", seq: 3, type: "transfer_started", data: {} },
      ],
    };
    const entries = describeActions(e, [1, 2, 3]);
    expect(entries.map((x) => [x.line, x.backend])).toEqual([
      ["book_appointment recorded as succeeded", true],
      ["Event: transfer_started", false],
    ]);
  });

  it("pairs a result with the call it answers, and shows a second result for one call as its own line", () => {
    const e: Evidence = {
      ...failedSample.evidence,
      items: [
        { kind: "tool_call", seq: 1, id: "t", name: "book_appointment", args: {} },
        { kind: "tool_result", seq: 2, id: "t", ok: true, platformOk: true, payload: "first" },
        { kind: "tool_result", seq: 3, id: "t", ok: false, platformOk: false, payload: "retry" },
      ],
    };
    expect(describeActions(e, [1, 2, 3]).map((x) => x.line)).toEqual(["book_appointment succeeded", "book_appointment failed"]);
  });

  it("pairs a result that arrived before its call, as timestamp order allows", () => {
    const e = resultBeforeCall.evidence;
    expect(e.items[21]).toMatchObject({ kind: "tool_result", seq: 22, id: "tc_03" });
    expect(e.items[23]).toMatchObject({ kind: "tool_call", seq: 24, id: "tc_03" });
    for (const seqs of [[22, 24], [22], [24]]) {
      const entries = describeActions(e, seqs);
      expect(entries.map((x) => x.line), String(seqs)).toEqual(["book_appointment succeeded"]);
      expect([...entries[0].seqs].sort()).toEqual([22, 24]);
    }
  });

  it("keeps two calls that share an id apart", () => {
    const e: Evidence = {
      ...failedSample.evidence,
      items: [
        { kind: "tool_call", seq: 1, id: "t", name: "check_availability", args: {} },
        { kind: "tool_call", seq: 2, id: "t", name: "check_availability", args: {} },
        { kind: "tool_result", seq: 3, id: "t", ok: true, platformOk: true, payload: {} },
      ],
    };
    // The result answers neither call for sure, so it is not named after either: it keeps the id.
    expect(describeActions(e, [1, 2, 3]).map((x) => x.line)).toEqual([
      "check_availability was called, no result came back",
      "check_availability was called, no result came back",
      "t succeeded",
    ]);
  });
});
