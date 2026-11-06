// @vitest-environment node
import { describe, expect, it } from "vitest";
import { compactJson } from "./json";

describe("compactJson", () => {
  it("keeps anything nesting two levels or less on one line", () => {
    expect(compactJson({ a: 1, b: [1, 2], c: { d: "x" } })).toBe('{ "a": 1, "b": [1, 2], "c": { "d": "x" } }\n');
  });

  it("indents deeper values by two spaces per level", () => {
    expect(compactJson({ outer: { inner: { leaf: [1] } }, n: null })).toBe('{\n  "outer": {\n    "inner": { "leaf": [1] }\n  },\n  "n": null\n}\n');
    expect(compactJson([[[1]], 2])).toBe("[\n  [[1]],\n  2\n]\n");
  });

  it("writes empty containers and leaves out undefined keys, as JSON.stringify does", () => {
    expect(compactJson({ a: [], b: {}, c: undefined })).toBe('{ "a": [], "b": {} }\n');
  });

  it("reads back to the same value", () => {
    const v = { cases: [{ id: "a", results: { x: "passed" }, deep: [{ k: [1, { z: true }] }] }], s: 'quote " and \\ slash' };
    expect(JSON.parse(compactJson(v))).toEqual(v);
  });
});
