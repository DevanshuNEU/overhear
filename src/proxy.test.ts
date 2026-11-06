import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const ORIGINAL_PASSWORD = process.env.DASHBOARD_PASSWORD;

afterEach(() => {
  if (ORIGINAL_PASSWORD === undefined) delete process.env.DASHBOARD_PASSWORD;
  else process.env.DASHBOARD_PASSWORD = ORIGINAL_PASSWORD;
});

function reqOf(path: string, headers: Record<string, string> = {}, method = "GET") {
  return new NextRequest(new Request(`http://localhost${path}`, { headers, method }));
}

const GOOD_AUTH = { authorization: `Basic ${btoa("user:secret")}` };

// Every page and API route a visitor can reach, before and after the move to /demo.
const GATED_PATHS = [
  "/",
  "/demo",
  "/demo/calls/call_abc",
  "/calls/call_abc",
  "/reports/call_sample_failed",
  "/how-it-works",
  "/eval",
  "/api/web-call",
];

// Retell's server-to-server callbacks and the health check: never behind the password.
const EXCLUDED_PATHS = [
  "/api/tools/check-availability",
  "/api/tools/verify-patient",
  "/api/tools/book-appointment",
  "/api/tools/reschedule-appointment",
  "/api/tools/cancel-appointment",
  "/api/webhooks/retell",
  "/api/health",
];

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
    const res = await proxy(reqOf("/demo/calls/123", GOOD_AUTH));
    expect(res?.status).not.toBe(401);
  });

  it("gates every page and API route, including the moved demo and the report screen", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    for (const path of GATED_PATHS) {
      const res = await proxy(reqOf(path));
      expect(res?.status, path).toBe(401);
    }
  });

  it("allows the excluded machine-to-machine and health routes without credentials", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    for (const path of EXCLUDED_PATHS) {
      const res = await proxy(reqOf(path, {}, "POST"));
      expect(res?.status, path).not.toBe(401);
      expect(res?.headers.get("location"), path).toBeNull();
    }
  });

  it("still gates /api/web-call", async () => {
    process.env.DASHBOARD_PASSWORD = "secret";
    const res = await proxy(reqOf("/api/web-call"));
    expect(res?.status).toBe(401);
  });

  it("matches the excluded routes out of the proxy, and nothing else", async () => {
    const { config } = await import("./proxy");
    const [pattern] = config.matcher;
    const re = new RegExp(`^${pattern}$`);
    for (const path of EXCLUDED_PATHS) expect(re.test(path), path).toBe(false);
    for (const path of GATED_PATHS) expect(re.test(path), path).toBe(true);
  });

  describe("old demo links", () => {
    it("redirects /calls/{id} to /demo/calls/{id}, keeping the query", async () => {
      delete process.env.DASHBOARD_PASSWORD;
      const res = await proxy(reqOf("/calls/abc?from=email"));
      expect(res?.status).toBe(307);
      expect(new URL(res!.headers.get("location")!).pathname).toBe("/demo/calls/abc");
      expect(new URL(res!.headers.get("location")!).search).toBe("?from=email");
    });

    it("asks for the password before redirecting when one is set", async () => {
      process.env.DASHBOARD_PASSWORD = "secret";
      const denied = await proxy(reqOf("/calls/abc"));
      expect(denied?.status).toBe(401);
      expect(denied?.headers.get("location")).toBeNull();

      const allowed = await proxy(reqOf("/calls/abc", GOOD_AUTH));
      expect(allowed?.status).toBe(307);
      expect(new URL(allowed!.headers.get("location")!).pathname).toBe("/demo/calls/abc");
    });

    it("does not redirect the new demo paths or the report screen", async () => {
      delete process.env.DASHBOARD_PASSWORD;
      for (const path of ["/", "/demo", "/demo/calls/abc", "/reports/call_sample_failed"]) {
        const res = await proxy(reqOf(path));
        expect(res?.headers.get("location"), path).toBeNull();
      }
    });
  });
});
