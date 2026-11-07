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

  it("runs on every path, the excluded ones and Next's own files included, so local mode can check them", async () => {
    const { config } = await import("./proxy");
    const [pattern] = config.matcher;
    const re = new RegExp(`^${pattern}$`);
    for (const path of [...EXCLUDED_PATHS, ...GATED_PATHS, "/_next/static/chunks/app.js", "/favicon.ico"]) expect(re.test(path), path).toBe(true);
  });

  it("on a hosted copy, passes the excluded paths untouched with any Host, as before", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "");
    process.env.DASHBOARD_PASSWORD = "secret";
    for (const path of [...EXCLUDED_PATHS, "/_next/static/chunks/app.js", "/favicon.ico"]) {
      const res = await proxy(reqOf(path, { host: "retell-callback.example" }, "POST"));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("location"), path).toBeNull();
      expect(res.headers.get("content-security-policy"), path).toBeNull();
      expect(res.headers.get("x-frame-options"), path).toBeNull();
    }
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

/** Local mode on a server Next says is bound to 127.0.0.1. Tests say so explicitly; nothing assumes it. */
function localMode() {
  vi.stubEnv("OVERHEAR_LOCAL", "1");
  vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3000");
}

describe("proxy in local mode (OVERHEAR_LOCAL=1)", () => {
  const LOOPBACK = { host: "localhost:3000" };
  const PAGES = ["/", "/reports/call_sample_failed", "/demo", "/how-it-works"];

  it("refuses a server-rendered page or a product route with a foreign Host", async () => {
    localMode();
    delete process.env.DASHBOARD_PASSWORD;
    for (const path of [...PAGES, "/api/connect", "/api/pulls", "/calls/abc"]) {
      for (const host of ["evil.com", "evil.com:3000", "192.168.1.20:3000"]) {
        const res = await proxy(reqOf(path, { host }));
        expect(res?.status, `${path} ${host}`).toBe(403);
      }
    }
  });

  it("lets a loopback GET through to pages and product routes", async () => {
    localMode();
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
    localMode();
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
    localMode();
    delete process.env.DASHBOARD_PASSWORD;
    const res = await proxy(reqOf("/api/connect", { ...LOOPBACK, origin: "http://localhost:3000" }, "POST"));
    expect(res?.status).toBe(200);
  });

  it("checks the Host before the password, so a foreign Host never sees the password prompt", async () => {
    localMode();
    process.env.DASHBOARD_PASSWORD = "secret";
    expect((await proxy(reqOf("/", { host: "evil.com" })))?.status).toBe(403);
    expect((await proxy(reqOf("/", LOOPBACK)))?.status).toBe(401);
    expect((await proxy(reqOf("/", { ...LOOPBACK, ...GOOD_AUTH })))?.status).toBe(200);
  });

  it("refuses a cross-site or same-site subresource GET to /reports/, with no Retell request, but lets a top-level navigation and the user's own pages through", async () => {
    localMode();
    delete process.env.DASHBOARD_PASSWORD;
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    for (const site of ["cross-site", "same-site"]) {
      for (const dest of ["image", "script", "style", "iframe", "empty", "frame", "embed", undefined]) {
        const headers: Record<string, string> = { ...LOOPBACK, "sec-fetch-site": site };
        if (dest) headers["sec-fetch-dest"] = dest;
        const res = await proxy(reqOf("/reports/call_made_up_123", headers));
        expect(res?.status, `${site} ${dest}`).toBe(403);
      }
    }
    expect(fetched).not.toHaveBeenCalled();
    // A top-level navigation (the user clicking a link) works, and so do the user's own pages and old browsers.
    expect((await proxy(reqOf("/reports/x", { ...LOOPBACK, "sec-fetch-site": "cross-site", "sec-fetch-dest": "document" })))?.status).toBe(200);
    expect((await proxy(reqOf("/reports/x", { ...LOOPBACK, "sec-fetch-site": "none", "sec-fetch-dest": "document" })))?.status).toBe(200);
    expect((await proxy(reqOf("/reports/x", { ...LOOPBACK, "sec-fetch-site": "same-origin", "sec-fetch-dest": "empty" })))?.status).toBe(200);
    expect((await proxy(reqOf("/reports/x", LOOPBACK)))?.status).toBe(200);
    // Other paths are not this rule's business.
    expect((await proxy(reqOf("/demo", { ...LOOPBACK, "sec-fetch-site": "cross-site", "sec-fetch-dest": "image" })))?.status).toBe(200);
  });

  it("refuses every request when the server is not bound to 127.0.0.1", async () => {
    localMode();
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://localhost:3000");
    delete process.env.DASHBOARD_PASSWORD;
    for (const path of ["/", "/api/connect", "/reports/call_sample_failed"]) {
      expect((await proxy(reqOf(path, LOOPBACK)))?.status, path).toBe(403);
    }
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3000");
    expect((await proxy(reqOf("/", { host: "127.0.0.1:3000" })))?.status).toBe(200);
  });

  it("checks the Host before the excluded paths, so health, Next's files, tools and the webhook refuse a foreign Host", async () => {
    localMode();
    for (const path of [...EXCLUDED_PATHS, "/_next/static/chunks/app.js", "/favicon.ico"]) {
      for (const method of ["GET", "POST"]) {
        const res = await proxy(reqOf(path, { host: "evil.com:3000", origin: "http://evil.com:3000" }, method));
        expect(res.status, `${method} ${path}`).toBe(403);
      }
    }
  });

  it("still lets loopback requests reach the excluded paths without the password", async () => {
    localMode();
    process.env.DASHBOARD_PASSWORD = "secret";
    for (const path of ["/api/health", "/_next/static/chunks/app.js", "/favicon.ico"]) {
      expect((await proxy(reqOf(path, LOOPBACK))).status, path).toBe(200);
    }
    const tool = await proxy(reqOf("/api/tools/check-availability", { ...LOOPBACK, origin: "http://localhost:3000" }, "POST"));
    expect(tool.status).toBe(200);
  });

  it("forbids framing on a page, an API route, an excluded path, a redirect, a 401 and a 403", async () => {
    localMode();
    delete process.env.DASHBOARD_PASSWORD;
    const responses = [
      await proxy(reqOf("/reports/call_sample_failed", LOOPBACK)),
      await proxy(reqOf("/", LOOPBACK)),
      await proxy(reqOf("/api/connect", LOOPBACK)),
      await proxy(reqOf("/api/health", LOOPBACK)),
      await proxy(reqOf("/calls/abc", LOOPBACK)),
      await proxy(reqOf("/", { host: "evil.com" })),
      await proxy(reqOf("/api/connect", { ...LOOPBACK, origin: "http://evil.com" }, "POST")),
    ];
    process.env.DASHBOARD_PASSWORD = "secret";
    responses.push(await proxy(reqOf("/", LOOPBACK)));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 307, 403, 403, 401]);
    for (const res of responses) {
      expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("treats the report screen the same with and without OVERHEAR_DEMO_STATES, read independently", async () => {
    localMode();
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
