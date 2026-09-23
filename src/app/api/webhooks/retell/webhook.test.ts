import { describe, it, expect, vi } from "vitest";
vi.mock("@/retell/verify", () => ({ verifyRetellSignature: (_b: string, s: string | null) => s === "good" }));
const scoreCall = vi.hoisted(() => vi.fn());
vi.mock("@/qa/pipeline", () => ({ scoreCall }));
import { POST } from "./route";

const req = (sig: string, body: unknown) =>
  new Request("http://x", { method: "POST", headers: { "x-retell-signature": sig }, body: JSON.stringify(body) });

describe("retell webhook", () => {
  it("401s bad signature", async () => {
    expect((await POST(req("bad", { event: "call_analyzed", call: {} }))).status).toBe(401);
  });
  it("ignores call_ended without scoring", async () => {
    const res = await POST(req("good", { event: "call_ended", call: { call_id: "c1" } }));
    expect(res.status).toBe(200);
    expect(scoreCall).not.toHaveBeenCalled();
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
