// @vitest-environment node
import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { EvalCaseSchema } from "@/engine/eval/case";
import { pinIdFor } from "./pin-id";

// The eval case id rule, read from the schema so the two cannot drift.
const idRule = EvalCaseSchema.shape.id;
const matchesCaseId = (id: string): boolean => idRule.safeParse(id).success;
const sha8 = (s: string): string => crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 8);

describe("pinIdFor", () => {
  it("is pin-, the slug, a hyphen and the first 8 hex of sha256 of the call id", () => {
    expect(pinIdFor("call_abc123")).toBe(`pin-call-abc123-${sha8("call_abc123")}`);
  });

  it("is deterministic", () => {
    expect(pinIdFor("call_abc123")).toBe(pinIdFor("call_abc123"));
  });

  it("lowercases and turns every run outside a-z and 0-9 into one hyphen, trimmed at both ends", () => {
    expect(pinIdFor("__Call  A..B__")).toBe(`pin-call-a-b-${sha8("__Call  A..B__")}`);
  });

  it("caps the slug at 48 characters and never leaves a hyphen before the hash", () => {
    const callId = `${"a".repeat(47)}_${"b".repeat(20)}`;
    const id = pinIdFor(callId);
    expect(id).toBe(`pin-${"a".repeat(47)}-${sha8(callId)}`);
    expect(id).not.toContain("--");
  });

  it("falls back to call when nothing is left of the slug", () => {
    expect(pinIdFor("")).toBe(`pin-call-${sha8("")}`);
    expect(pinIdFor("../")).toBe(`pin-call-${sha8("../")}`);
    expect(pinIdFor("é中")).toBe(`pin-call-${sha8("é中")}`);
  });

  it("tells ids apart that differ only in case or punctuation", () => {
    expect(pinIdFor("Call_A")).not.toBe(pinIdFor("call_a"));
    expect(pinIdFor("call_a")).not.toBe(pinIdFor("call-a"));
    expect(pinIdFor("Call_A").startsWith("pin-call-a-")).toBe(true);
    expect(pinIdFor("call_a").startsWith("pin-call-a-")).toBe(true);
  });

  const hostile: [string, string][] = [
    ["path traversal", "../x"],
    ["deep traversal", "../../etc/passwd"],
    ["absolute path", "/etc/passwd"],
    ["backslashes", "..\\..\\x"],
    ["uppercase", "CALL_ABCDEF"],
    ["unicode", "call_üñîçødé_中文_😀"],
    ["turkish dotted capital i", "İstanbul"],
    ["over-long", "x".repeat(5000)],
    ["over-long with trailing punctuation", `${"a".repeat(48)}-----${"b".repeat(100)}`],
    ["empty", ""],
    ["whitespace only", " \t\n"],
    ["null byte", "call\u0000x"],
    ["only hyphens", "-----"],
    ["leading hyphens", "---abc"],
    ["__proto__", "__proto__"],
    ["dots", "..."],
  ];

  it.each(hostile)("%s gives an id that matches the case id rule and fits in 64 characters", (_name, callId) => {
    const id = pinIdFor(callId);
    expect(matchesCaseId(id)).toBe(true);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id.startsWith("pin-")).toBe(true);
    expect(id.endsWith(`-${sha8(callId)}`)).toBe(true);
    expect(id).not.toMatch(/[./\\]/);
  });

  it("matches the request id shape the routes accept", () => {
    for (const [, callId] of hostile) expect(pinIdFor(callId)).toMatch(/^pin-[a-z0-9-]{1,64}$/);
  });
});
