import { describe, expect, it, vi } from "vitest";
import { clientIp, reserveWebCall } from "./web-call-limit";

const from = (ip: string) => new Request("http://x", { method: "POST", headers: { "x-forwarded-for": ip } });

describe("the web call limiter", () => {
  it("allows 3 starts per visitor, then says how long to wait", () => {
    for (let i = 0; i < 3; i++) expect(reserveWebCall(from("10.1.0.1")).allowed).toBe(true);
    const blocked = reserveWebCall(from("10.1.0.1"));
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("counts against the last x-forwarded-for entry, not one the client wrote", () => {
    const spoof = (fake: string) => from(`${fake}, 10.1.0.9`);
    for (let i = 0; i < 3; i++) expect(reserveWebCall(spoof(`1.1.1.${i}`)).allowed).toBe(true);
    expect(reserveWebCall(spoof("1.1.1.99")).allowed).toBe(false);
    expect(clientIp(from("10.1.0.9"))).toBe("10.1.0.9");
    expect(clientIp(from(" 9.9.9.9 , 10.1.0.8 "))).toBe("10.1.0.8");
  });

  it("uses one shared bucket when the header is missing or empty", () => {
    expect(clientIp(new Request("http://x"))).toBe("unknown");
    expect(clientIp(from(""))).toBe("unknown");
    expect(clientIp(from("a, "))).toBe("unknown");
  });

  it("counts visitors apart", () => {
    for (let i = 0; i < 3; i++) reserveWebCall(from("10.1.0.2"));
    expect(reserveWebCall(from("10.1.0.3")).allowed).toBe(true);
  });

  it("gives the slots back on refund, once, so failed starts use nothing up", () => {
    for (let i = 0; i < 20; i++) {
      const r = reserveWebCall(from("10.1.0.4"));
      expect(r.allowed).toBe(true);
      if (r.allowed) {
        r.refund();
        r.refund();
      }
    }
    // The 3 real starts still fit afterwards: nothing was left behind or taken twice.
    for (let i = 0; i < 3; i++) expect(reserveWebCall(from("10.1.0.4")).allowed).toBe(true);
    expect(reserveWebCall(from("10.1.0.4")).allowed).toBe(false);
  });

  it("caps a visitor at 6 a day on top of 3 per 10 minutes", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      for (let round = 0; round < 2; round++) {
        for (let i = 0; i < 3; i++) expect(reserveWebCall(from("10.1.0.5")).allowed).toBe(true);
        expect(reserveWebCall(from("10.1.0.5")).allowed).toBe(false);
        vi.advanceTimersByTime(11 * 60 * 1000);
      }
      // Both 10 minute windows have passed, but 6 starts are inside the last 24 hours.
      const blocked = reserveWebCall(from("10.1.0.5"));
      expect(blocked.allowed).toBe(false);
      if (!blocked.allowed) expect(blocked.retryAfter).toBeGreaterThan(60 * 60);
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
      expect(reserveWebCall(from("10.1.0.5")).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives the owner a budget of 10 per address that the public budget does not touch", () => {
    for (let i = 0; i < 3; i++) reserveWebCall(from("10.1.0.6"));
    expect(reserveWebCall(from("10.1.0.6")).allowed).toBe(false);
    for (let i = 0; i < 10; i++) expect(reserveWebCall(from("10.1.0.6"), true).allowed).toBe(true);
    expect(reserveWebCall(from("10.1.0.6"), true).allowed).toBe(false);
  });
});
