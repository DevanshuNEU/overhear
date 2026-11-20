import { describe, expect, it } from "vitest";
import { checkWebCallLimit, clientIp } from "./web-call-limit";

const from = (ip: string) => new Request("http://x", { method: "POST", headers: { "x-forwarded-for": ip } });

describe("the web call limiter", () => {
  it("allows 3 starts per visitor, then says how long to wait", () => {
    for (let i = 0; i < 3; i++) expect(checkWebCallLimit(from("10.1.0.1")).allowed).toBe(true);
    const blocked = checkWebCallLimit(from("10.1.0.1"));
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("counts against the last x-forwarded-for entry, not one the client wrote", () => {
    const spoof = (fake: string) => from(`${fake}, 10.1.0.9`);
    for (let i = 0; i < 3; i++) expect(checkWebCallLimit(spoof(`1.1.1.${i}`)).allowed).toBe(true);
    expect(checkWebCallLimit(spoof("1.1.1.99")).allowed).toBe(false);
    expect(clientIp(from("10.1.0.9"))).toBe("10.1.0.9");
    expect(clientIp(from(" 9.9.9.9 , 10.1.0.8 "))).toBe("10.1.0.8");
  });

  it("uses one shared bucket when the header is missing or empty", () => {
    expect(clientIp(new Request("http://x"))).toBe("unknown");
    expect(clientIp(from(""))).toBe("unknown");
    expect(clientIp(from("a, "))).toBe("unknown");
  });

  it("counts visitors apart", () => {
    for (let i = 0; i < 3; i++) checkWebCallLimit(from("10.1.0.2"));
    expect(checkWebCallLimit(from("10.1.0.3")).allowed).toBe(true);
  });
});
