// @vitest-environment node
// readPath: how a policy path such as "result.slots" or "args.flights.0.date" reads a value out of a tool call.
import { describe, expect, it } from "vitest";
import { InputError } from "./types";
import { readPath } from "./paths";

describe("readPath", () => {
  const roots = {
    args: { slotId: "s-1", flights: [{ date: "2026-11-06" }] },
    result: { ok: true, slots: [{ id: "s-1", startsAt: "2026-11-06T14:00:00.000Z" }], data: { status: { ok: false } } },
    item: { id: "s-1", providerName: "Dr. Priya Nair" },
    call: { call_analysis: { custom_analysis_data: { requested_date: "2026-11-06" } } },
  };

  it("reads each root", () => {
    expect(readPath("args.slotId", roots)).toBe("s-1");
    expect(readPath("result.slots", roots)).toEqual(roots.result.slots);
    expect(readPath("item.providerName", roots)).toBe("Dr. Priya Nair");
    expect(readPath("call.call_analysis.custom_analysis_data.requested_date", roots)).toBe("2026-11-06");
  });

  it("reads a whole root when the path is the bare root, whatever it holds", () => {
    expect(readPath("result", { result: ["a", "b"] })).toEqual(["a", "b"]);
    expect(readPath("result", { result: "OK" })).toBe("OK");
  });

  it("indexes arrays with numeric segments and reads nested objects", () => {
    expect(readPath("args.flights.0.date", roots)).toBe("2026-11-06");
    expect(readPath("result.slots.0.startsAt", roots)).toBe("2026-11-06T14:00:00.000Z");
    expect(readPath("result.data.status.ok", roots)).toBe(false);
  });

  it("gives undefined for anything missing, never throws on the data", () => {
    expect(readPath("result.missing.deeper", roots)).toBeUndefined();
    expect(readPath("args.flights.5.date", roots)).toBeUndefined();
    expect(readPath("args.flights.first", roots)).toBeUndefined();
    expect(readPath("result.ok.deeper", roots)).toBeUndefined();
    expect(readPath("item.id", {})).toBeUndefined();
    expect(readPath("result.ok", { result: "OK" })).toBeUndefined();
    expect(readPath("result.ok", { result: null })).toBeUndefined();
  });

  it("reads only a value's own keys, so a path never reaches into the prototype", () => {
    expect(readPath("result.constructor", { result: {} })).toBeUndefined();
    expect(readPath("result.slots.length", roots)).toBeUndefined();
    expect(readPath("result.__proto__", { result: {} })).toBeUndefined();
  });

  it("rejects a path with no known root, naming it", () => {
    expect(() => readPath("ok", roots)).toThrow(InputError);
    expect(() => readPath("ok", roots)).toThrow(/"ok"/);
    expect(() => readPath("payload.ok", roots)).toThrow(/"payload\.ok"/);
  });

  it("rejects a path with an empty segment", () => {
    expect(() => readPath("result..ok", roots)).toThrow(InputError);
    expect(() => readPath("result.", roots)).toThrow(InputError);
    expect(() => readPath("", roots)).toThrow(InputError);
  });
});
