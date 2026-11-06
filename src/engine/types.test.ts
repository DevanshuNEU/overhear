// @vitest-environment node
import { describe, expect, it } from "vitest";
import { InputError, type Outcome } from "./types";
import { passedSample } from "@/report/samples";

describe("InputError", () => {
  it("is an Error that carries the message and how to fix it", () => {
    const err = new InputError("This is not a Retell call: it has no call_id.", "Pass the record from get-call.");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InputError);
    expect(err.name).toBe("InputError");
    expect(err.message).toBe("This is not a Retell call: it has no call_id.");
    expect(err.fix).toBe("Pass the record from get-call.");
  });
});

describe("Outcome", () => {
  it("is plain data: every kind survives a JSON round trip unchanged", () => {
    const outcomes: Outcome[] = [
      { kind: "report", report: passedSample },
      { kind: "no_content", callId: "call_sample_none" },
      { kind: "error", message: "The report did not validate." },
    ];
    for (const o of outcomes) expect(JSON.parse(JSON.stringify(o))).toEqual(o);
  });
});
