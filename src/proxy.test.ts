import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const ORIGINAL_PASSWORD = process.env.DASHBOARD_PASSWORD;

afterEach(() => {
  if (ORIGINAL_PASSWORD === undefined) delete process.env.DASHBOARD_PASSWORD;
  else process.env.DASHBOARD_PASSWORD = ORIGINAL_PASSWORD;
});

function reqOf(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new Request(`http://localhost${path}`, { headers }));
}

describe("proxy", () => {
  it("allows every request when no password is configured", async () => {
    delete process.env.DASHBOARD_PASSWORD;
    const res = await proxy(reqOf("/"));
    expect(res?.status).not.toBe(401);
  });

  it("401s a gated path with no credentials when a password is set", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    const res = await proxy(reqOf("/"));
    expect(res?.status).toBe(401);
    expect(res?.headers.get("WWW-Authenticate")).toBe('Basic realm="Overhear"');
  });

  it("401s a gated path with the wrong password", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    const auth = `Basic ${btoa("user:wrong")}`;
    const res = await proxy(reqOf("/", { authorization: auth }));
    expect(res?.status).toBe(401);
  });

  it("allows a gated path with the right password", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    const auth = `Basic ${btoa("user:secret")}`;
    const res = await proxy(reqOf("/calls/123", { authorization: auth }));
    expect(res?.status).not.toBe(401);
  });

  it("allows the excluded machine-to-machine and health routes without credentials", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    const paths = ["/api/tools/check-availability", "/api/webhooks/retell", "/api/health"];
    for (const path of paths) {
      const res = await proxy(reqOf(path));
      expect(res?.status).not.toBe(401);
    }
  });

  it("still gates /api/web-call", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    const res = await proxy(reqOf("/api/web-call"));
    expect(res?.status).toBe(401);
  });
});
