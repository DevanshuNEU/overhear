import { describe, it, expect } from "vitest";
import { reconcile } from "./reconciler";
import type { ActionEvent, CallContext } from "./types";

const ev = (tool: ActionEvent["tool"], result: Record<string, unknown>, ts: string, ok = true): ActionEvent =>
  ({ id: crypto.randomUUID(), callId: "c", tool, args: {}, result, ok, ts });
const ctx = (events: ActionEvent[]): CallContext =>
  ({ callId: "c", transcript: [], actionEvents: events, trueSlots: [], callerGoal: "book" });

describe("reconcile", () => {
  it("passes identity_verified when verify precedes booking", () => {
    const r = reconcile(ctx([
      ev("verify_patient", { verified: true }, "2026-01-01T10:00:00Z"),
      ev("book_appointment", { ok: true }, "2026-01-01T10:01:00Z"),
    ]));
    expect(r.identity_verified.passed).toBe(true);
    expect(r.task_success.passed).toBe(true);
  });
  it("fails identity_verified when booking happens before verification", () => {
    const r = reconcile(ctx([
      ev("book_appointment", { ok: true }, "2026-01-01T10:00:00Z"),
      ev("verify_patient", { verified: true }, "2026-01-01T10:01:00Z"),
    ]));
    expect(r.identity_verified.passed).toBe(false);
  });
  it("fails task_success when no successful mutation exists", () => {
    const r = reconcile(ctx([ev("check_availability", { slots: [] }, "2026-01-01T10:00:00Z")]));
    expect(r.task_success.passed).toBe(false);
  });
  it("fails correct_tool_use when a mutation returned ok:false", () => {
    const r = reconcile(ctx([
      ev("verify_patient", { verified: true }, "2026-01-01T10:00:00Z"),
      ev("book_appointment", { ok: false }, "2026-01-01T10:01:00Z", false),
    ]));
    expect(r.correct_tool_use.passed).toBe(false);
  });
});
