import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@/retell/verify", () => ({ verifyRetellSignature: (_b: string, s: string | null) => s === "good" }));
import { POST } from "./route";

const req = (sig: string, body: unknown) =>
  new Request("http://x", { method: "POST", headers: { "x-retell-signature": sig }, body: typeof body === "string" ? body : JSON.stringify(body) });

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("retell webhook", () => {
  it("401s bad signature and logs it as present-but-invalid", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await POST(req("bad", { event: "call_analyzed", call: {} }))).status).toBe(401);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("present but verification failed"));
    expect(log).not.toHaveBeenCalled();
  });
  it("401s a request with no signature header and logs the missing header", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(new Request("http://x", {
      method: "POST",
      body: JSON.stringify({ event: "call_analyzed", call: {} }),
    }));
    expect(res.status).toBe(401);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no x-retell-signature header"));
  });
  it("answers 200 and logs the event type and call id", async () => {
    const res = await POST(req("good", { event: "call_ended", call: { call_id: "c1" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(log).toHaveBeenCalledWith("retell webhook: call_ended for call c1");
  });
  it("answers 200 for call_analyzed too", async () => {
    const res = await POST(req("good", { event: "call_analyzed", call: { call_id: "c2" } }));
    expect(res.status).toBe(200);
    expect(log).toHaveBeenCalledWith("retell webhook: call_analyzed for call c2");
  });
  it("answers 200 (no retry storm) for a signed body that is not JSON", async () => {
    const res = await POST(req("good", "not json"));
    expect(res.status).toBe(200);
  });
});
