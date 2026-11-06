import { describe, it, expect, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

const ORIGINAL_PASSWORD = process.env.DASHBOARD_PASSWORD;

afterEach(() => {
  vi.unstubAllEnvs();
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

describe("proxy in local mode (OVERHEAR_LOCAL=1)", () => {
  const LOOPBACK = { host: "localhost:3000" };
  const PAGES = ["/", "/reports/call_sample_failed", "/demo", "/how-it-works"];

  it("refuses a server-rendered page or a product route with a foreign Host", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    delete process.env.DASHBOARD_PASSWORD;
    for (const path of [...PAGES, "/api/connect", "/api/pulls", "/calls/abc"]) {
      for (const host of ["evil.com", "evil.com:3000", "192.168.1.20:3000"]) {
        const res = await proxy(reqOf(path, { host }));
        expect(res?.status, `${path} ${host}`).toBe(403);
      }
    }
  });

  it("lets a loopback GET through to pages and product routes", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    delete process.env.DASHBOARD_PASSWORD;
    for (const path of [...PAGES, "/api/connect"]) {
      for (const host of ["localhost:3000", "127.0.0.1:4100", "[::1]:3000"]) {
        const res = await proxy(reqOf(path, { host }));
        expect(res?.status, `${path} ${host}`).toBe(200);
        expect(res?.headers.get("location"), path).toBeNull();
      }
    }
  });

  it("refuses a state-changing request with a foreign or missing Origin, on any path", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    delete process.env.DASHBOARD_PASSWORD;
    for (const path of ["/api/connect", "/", "/reports/call_sample_failed"]) {
      for (const origin of ["http://evil.com", "http://localhost:3001", "null", undefined]) {
        const headers: Record<string, string> = { ...LOOPBACK };
        if (origin) headers.origin = origin;
        for (const method of ["POST", "DELETE"]) {
          const res = await proxy(reqOf(path, headers, method));
          expect(res?.status, `${method} ${path} ${origin}`).toBe(403);
        }
      }
    }
  });

  it("lets a same-origin POST through", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    delete process.env.DASHBOARD_PASSWORD;
    const res = await proxy(reqOf("/api/connect", { ...LOOPBACK, origin: "http://localhost:3000" }, "POST"));
    expect(res?.status).toBe(200);
  });

  it("checks the Host before the password, so a foreign Host never sees the password prompt", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    process.env.DASHBOARD_PASSWORD = "secret";
    expect((await proxy(reqOf("/", { host: "evil.com" })))?.status).toBe(403);
    expect((await proxy(reqOf("/", LOOPBACK)))?.status).toBe(401);
    expect((await proxy(reqOf("/", { ...LOOPBACK, ...GOOD_AUTH })))?.status).toBe(200);
  });

  it("refuses every request when the server is not bound to 127.0.0.1", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://localhost:3000");
    delete process.env.DASHBOARD_PASSWORD;
    for (const path of ["/", "/api/connect", "/reports/call_sample_failed"]) {
      expect((await proxy(reqOf(path, LOOPBACK)))?.status, path).toBe(403);
    }
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3000");
    expect((await proxy(reqOf("/", { host: "127.0.0.1:3000" })))?.status).toBe(200);
  });

  it("leaves the excluded machine-to-machine routes alone, whatever the Host", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    for (const path of EXCLUDED_PATHS) {
      const res = await proxy(reqOf(path, { host: "retell-callback.example" }, "POST"));
      expect(res?.status, path).toBe(200);
    }
  });

  it("treats the report screen the same with and without OVERHEAR_DEMO_STATES, read independently", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    delete process.env.DASHBOARD_PASSWORD;
    for (const flag of ["1", ""]) {
      vi.stubEnv("OVERHEAR_DEMO_STATES", flag);
      for (const path of ["/reports/call_sample_failed", "/reports/call_demo_unverified"]) {
        expect((await proxy(reqOf(path, LOOPBACK)))?.status, `${path} ${flag}`).toBe(200);
        expect((await proxy(reqOf(path, { host: "evil.com" })))?.status, `${path} ${flag}`).toBe(403);
      }
    }
    vi.stubEnv("OVERHEAR_LOCAL", "");
    vi.stubEnv("OVERHEAR_DEMO_STATES", "1");
    expect((await proxy(reqOf("/api/connect", LOOPBACK)))?.status).toBe(404);
  });
});

describe("proxy on a hosted copy (OVERHEAR_LOCAL unset)", () => {
  it("answers 404 for the key, pull and call routes, on every method", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "");
    delete process.env.DASHBOARD_PASSWORD;
    for (const path of ["/api/connect", "/api/connect/", "/api/pulls", "/api/pulls/p1", "/api/pulls/p1/cancel", "/api/calls/c1/refetch"]) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const res = await proxy(reqOf(path, { host: "overhear.up.railway.app", origin: "https://overhear.up.railway.app" }, method));
        expect(res?.status, `${method} ${path}`).toBe(404);
      }
    }
  });

  it("answers 404 for them before asking for the password", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "");
    process.env.DASHBOARD_PASSWORD = "secret";
    expect((await proxy(reqOf("/api/connect")))?.status).toBe(404);
  });

  it("keeps serving the report screen, the demo and the other pages, with any Host", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "");
    delete process.env.DASHBOARD_PASSWORD;
    for (const path of ["/reports/call_sample_failed", "/demo", "/", "/how-it-works", "/api/web-call"]) {
      const res = await proxy(reqOf(path, { host: "overhear.up.railway.app" }));
      expect(res?.status, path).toBe(200);
    }
  });
});
