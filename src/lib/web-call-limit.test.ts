import { describe, expect, it } from "vitest";
import { checkWebCallLimit } from "./web-call-limit";

const from = (ip: string) => new Request("http://x", { method: "POST", headers: { "x-forwarded-for": ip } });

describe("the web call limiter", () => {
  it("allows 3 starts per visitor, then says how long to wait", () => {
    for (let i = 0; i < 3; i++) expect(checkWebCallLimit(from("10.1.0.1")).allowed).toBe(true);
    const blocked = checkWebCallLimit(from("10.1.0.1"));
    expect(blocked.allowed).toBe(false);
    if (!blocked.allowed) expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("counts visitors apart", () => {
    for (let i = 0; i < 3; i++) checkWebCallLimit(from("10.1.0.2"));
    expect(checkWebCallLimit(from("10.1.0.3")).allowed).toBe(true);
  });
});
