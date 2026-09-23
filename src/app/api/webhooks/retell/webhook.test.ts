import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/retell/verify", () => ({ verifyRetellSignature: (_b: string, s: string | null) => s === "good" }));
const { scoreCall, recordPendingCall } = vi.hoisted(() => ({ scoreCall: vi.fn(), recordPendingCall: vi.fn() }));
vi.mock("@/qa/pipeline", () => ({ scoreCall, recordPendingCall }));
import { POST } from "./route";

const req = (sig: string, body: unknown) =>
  new Request("http://x", { method: "POST", headers: { "x-retell-signature": sig }, body: JSON.stringify(body) });

beforeEach(() => {
  scoreCall.mockReset();
  recordPendingCall.mockReset();
  // The route logs every accepted event; keep the test output clean.
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("retell webhook", () => {
  it("401s bad signature and logs it as present-but-invalid", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await POST(req("bad", { event: "call_analyzed", call: {} }))).status).toBe(401);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("present but verification failed"));
    warn.mockRestore();
  });
  it("401s a request with no signature header and logs the missing header", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ event: "call_analyzed", call: {} }),
    }));
    expect(res.status).toBe(401);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no x-retell-signature header"));
    warn.mockRestore();
  });
  it("records a pending call on call_ended without scoring it", async () => {
    const res = await POST(req("good", { event: "call_ended", call: { call_id: "c1" } }));
    expect(res.status).toBe(200);
    expect(recordPendingCall).toHaveBeenCalledWith(expect.objectContaining({ call_id: "c1" }));
    expect(scoreCall).not.toHaveBeenCalled();
  });
  it("returns 200 (no retry storm) when recording a pending call throws", async () => {
    recordPendingCall.mockRejectedValueOnce(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req("good", { event: "call_ended", call: { call_id: "c1" } }));
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
  it("scores on call_analyzed", async () => {
    await POST(req("good", { event: "call_analyzed", call: { call_id: "c1" } }));
    expect(scoreCall).toHaveBeenCalledWith(expect.objectContaining({ call_id: "c1" }));
  });
  it("returns 200 (no retry storm) when scoring throws", async () => {
    scoreCall.mockRejectedValueOnce(new Error("judge down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(req("good", { event: "call_analyzed", call: { call_id: "c2" } }));
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
