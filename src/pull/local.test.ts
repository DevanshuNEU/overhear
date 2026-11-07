// @vitest-environment node
import { describe, it, expect } from "vitest";
import { assertLocalRequest, checkLocalRequest, FRAME_HEADERS, isLocalMode, isLoopbackBind, isLoopbackHost, isProductApiPath, isSameOrigin } from "./local";

// Local mode on a server Next says is bound to 127.0.0.1. Tests say so explicitly; nothing assumes it.
const LOCAL = { OVERHEAR_LOCAL: "1", __NEXT_PRIVATE_ORIGIN: "http://127.0.0.1:3000" };
const HOSTED = {};

function req(method: string, headers: Record<string, string>, path = "/api/connect") {
  return new Request(`http://localhost${path}`, { method, headers });
}

describe("isLocalMode", () => {
  it("is on only when OVERHEAR_LOCAL is 1", () => {
    expect(isLocalMode({ OVERHEAR_LOCAL: "1" })).toBe(true);
  });

  it("is off when OVERHEAR_LOCAL is unset, empty or any other value", () => {
    for (const value of [undefined, "", "0", "true", "yes"]) {
      expect(isLocalMode({ OVERHEAR_LOCAL: value }), String(value)).toBe(false);
    }
  });

  it("reads process.env by default", () => {
    const before = process.env.OVERHEAR_LOCAL;
    try {
      process.env.OVERHEAR_LOCAL = "1";
      expect(isLocalMode()).toBe(true);
      delete process.env.OVERHEAR_LOCAL;
      expect(isLocalMode()).toBe(false);
    } finally {
      if (before === undefined) delete process.env.OVERHEAR_LOCAL;
      else process.env.OVERHEAR_LOCAL = before;
    }
  });
});

describe("isLoopbackHost", () => {
  it("passes localhost, 127.0.0.1 and [::1], with or without a port", () => {
    for (const host of ["localhost", "localhost:3000", "LOCALHOST:3000", "127.0.0.1", "127.0.0.1:55001", "[::1]", "[::1]:3000"]) {
      expect(isLoopbackHost(host), host).toBe(true);
    }
  });

  it("refuses every other host, a missing one and look-alikes", () => {
    for (const host of [
      null,
      "",
      "evil.com",
      "evil.com:3000",
      "localhost.evil.com",
      "localhost.evil.com:3000",
      "127.0.0.1.nip.io",
      "127.0.0.2",
      "0.0.0.0:3000",
      "192.168.1.20:3000",
      "::1",
      "[::1].evil.com",
      "localhost:",
      "localhost:abc",
      "localhost:3000:3000",
      "user@localhost",
      " localhost",
    ]) {
      expect(isLoopbackHost(host), String(host)).toBe(false);
    }
  });
});

describe("isSameOrigin", () => {
  it("passes an Origin equal to the request's own Host, port included", () => {
    expect(isSameOrigin("http://localhost:3000", "localhost:3000")).toBe(true);
    expect(isSameOrigin("http://127.0.0.1:4100", "127.0.0.1:4100")).toBe(true);
    expect(isSameOrigin("http://[::1]:3000", "[::1]:3000")).toBe(true);
    expect(isSameOrigin("https://localhost:3000", "localhost:3000")).toBe(true);
  });

  it("refuses a missing Origin, Origin: null, a foreign Origin and one on another port", () => {
    expect(isSameOrigin(null, "localhost:3000")).toBe(false);
    expect(isSameOrigin("null", "localhost:3000")).toBe(false);
    expect(isSameOrigin("http://evil.com", "localhost:3000")).toBe(false);
    expect(isSameOrigin("http://localhost:3001", "localhost:3000")).toBe(false);
    expect(isSameOrigin("http://localhost", "localhost:3000")).toBe(false);
    expect(isSameOrigin("http://localhost:3000/", "localhost:3000")).toBe(false);
    expect(isSameOrigin("file://localhost:3000", "localhost:3000")).toBe(false);
    expect(isSameOrigin("http://localhost:3000", null)).toBe(false);
  });
});

describe("isProductApiPath", () => {
  it("covers the key, pull and call routes on a path boundary", () => {
    for (const path of ["/api/connect", "/api/connect/", "/api/pulls", "/api/pulls/p1", "/api/pulls/p1/cancel", "/api/calls/c1/refetch"]) {
      expect(isProductApiPath(path), path).toBe(true);
    }
    for (const path of ["/api/connection", "/api/pullsx", "/api/web-call", "/reports/call_sample_failed", "/", "/demo/calls/c1", "/calls/c1"]) {
      expect(isProductApiPath(path), path).toBe(false);
    }
  });
});

describe("isLoopbackBind", () => {
  it("trusts a server Next says is on 127.0.0.1", () => {
    expect(isLoopbackBind({ __NEXT_PRIVATE_ORIGIN: "http://127.0.0.1:3000" })).toBe(true);
    expect(isLoopbackBind({ __NEXT_PRIVATE_ORIGIN: "https://127.0.0.1:3000" })).toBe(true);
  });

  it("refuses localhost and [::1], which Next also writes for 0.0.0.0 and ::, and any other address", () => {
    for (const origin of ["http://localhost:3000", "http://[::1]:3000", "http://192.168.1.20:3000", "http://0.0.0.0:3000", "not a url"]) {
      expect(isLoopbackBind({ __NEXT_PRIVATE_ORIGIN: origin }), origin).toBe(false);
    }
  });

  it("fails closed when Next has not said where it is bound", () => {
    expect(isLoopbackBind({})).toBe(false);
    expect(isLoopbackBind({ __NEXT_PRIVATE_ORIGIN: "" })).toBe(false);
  });
});

describe("assertLocalRequest", () => {
  it("refuses everything when Next has not said where it is bound", () => {
    expect(assertLocalRequest(req("GET", { host: "127.0.0.1:3000" }), { OVERHEAR_LOCAL: "1" })?.status).toBe(403);
  });

  it("refuses everything when local mode runs on a server bound to every interface", () => {
    const res = assertLocalRequest(req("GET", { host: "localhost:3000" }), { ...LOCAL, __NEXT_PRIVATE_ORIGIN: "http://localhost:3000" });
    expect(res?.status).toBe(403);
    expect(assertLocalRequest(req("GET", { host: "127.0.0.1:3000" }), { ...LOCAL, __NEXT_PRIVATE_ORIGIN: "http://127.0.0.1:3000" })).toBeNull();
  });

  it("answers 404 when OVERHEAR_LOCAL is unset", () => {
    const res = assertLocalRequest(req("GET", { host: "localhost:3000" }), HOSTED);
    expect(res?.status).toBe(404);
  });

  it("refuses a foreign Host with 403", () => {
    for (const host of ["evil.com", "evil.com:3000", "192.168.1.20:3000", "localhost.evil.com:3000"]) {
      expect(assertLocalRequest(req("GET", { host }), LOCAL)?.status, host).toBe(403);
    }
  });

  it("refuses a request with no Host", () => {
    expect(assertLocalRequest(req("GET", {}), LOCAL)?.status).toBe(403);
  });

  it("passes localhost, 127.0.0.1 and [::1] with any port on a GET", () => {
    for (const host of ["localhost", "localhost:3000", "127.0.0.1:55001", "[::1]:3000"]) {
      expect(assertLocalRequest(req("GET", { host }), LOCAL), host).toBeNull();
    }
  });

  it("refuses a POST with a foreign Origin, an Origin on another port, Origin: null or no Origin", () => {
    const host = "localhost:3000";
    for (const origin of ["http://evil.com", "http://localhost:3001", "null", undefined]) {
      const headers: Record<string, string> = { host };
      if (origin !== undefined) headers.origin = origin;
      expect(assertLocalRequest(req("POST", headers), LOCAL)?.status, String(origin)).toBe(403);
    }
  });

  it("checks the Origin on DELETE, PUT, PATCH and OPTIONS too", () => {
    for (const method of ["DELETE", "PUT", "PATCH", "OPTIONS"]) {
      expect(assertLocalRequest(req(method, { host: "localhost:3000", origin: "http://evil.com" }), LOCAL)?.status, method).toBe(403);
    }
  });

  it("passes a POST whose Origin is the request's own Host", () => {
    for (const host of ["localhost:3000", "127.0.0.1:55001", "[::1]:3000"]) {
      expect(assertLocalRequest(req("POST", { host, origin: `http://${host}` }), LOCAL), host).toBeNull();
    }
  });

  it("refuses a same-origin POST when the Host itself is foreign (DNS rebinding)", () => {
    const res = assertLocalRequest(req("POST", { host: "evil.com:3000", origin: "http://evil.com:3000" }), LOCAL);
    expect(res?.status).toBe(403);
  });

  it("never caches its refusals", () => {
    const res = assertLocalRequest(req("GET", { host: "evil.com" }), LOCAL);
    expect(res?.headers.get("cache-control")).toBe("no-store");
  });

  it("forbids framing on every refusal", () => {
    for (const res of [assertLocalRequest(req("GET", { host: "evil.com" }), LOCAL), assertLocalRequest(req("GET", { host: "localhost" }), {})]) {
      expect(res?.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      expect(res?.headers.get("x-frame-options")).toBe("DENY");
    }
  });
});

describe("FRAME_HEADERS", () => {
  it("is the two headers that stop another site framing the local server", () => {
    expect(FRAME_HEADERS).toEqual({ "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY" });
  });
});

describe("checkLocalRequest: cross-site subresources of /reports/", () => {
  const get = (path: string, site?: string, dest?: string, purpose?: string) => {
    const headers: Record<string, string> = { host: "localhost:3000" };
    if (site) headers["sec-fetch-site"] = site;
    if (dest) headers["sec-fetch-dest"] = dest;
    if (purpose) headers["sec-purpose"] = purpose;
    return checkLocalRequest(req("GET", headers, path), LOCAL);
  };

  it("refuses a cross-site or same-site GET that is not a document, with 403 and no caching", async () => {
    for (const site of ["cross-site", "same-site"]) {
      const res = get("/reports/call_x", site, "image");
      expect(res?.status).toBe(403);
      expect(res?.headers.get("cache-control")).toBe("no-store");
      expect(res?.headers.get("x-frame-options")).toBe("DENY");
      expect(get("/reports/call_x", site)?.status).toBe(403);
    }
    expect(checkLocalRequest(req("HEAD", { host: "localhost:3000", "sec-fetch-site": "cross-site", "sec-fetch-dest": "image" }, "/reports/x"), LOCAL)?.status).toBe(403);
  });

  it("lets a top-level navigation, the same origin, a typed address and a client without Fetch Metadata through", () => {
    expect(get("/reports/call_x", "cross-site", "document")).toBeNull();
    expect(get("/reports/call_x", "same-site", "document")).toBeNull();
    expect(get("/reports/call_x", "same-origin", "empty")).toBeNull();
    expect(get("/reports/call_x", "none", "document")).toBeNull();
    expect(get("/reports/call_x")).toBeNull();
  });

  it("refuses a cross-site or same-site prefetch even though it arrives as a document", () => {
    for (const site of ["cross-site", "same-site"]) {
      for (const purpose of ["prefetch", "prefetch;anonymous-client-ip", "Prefetch", "prefetch;prerender"]) {
        expect(get("/reports/call_x", site, "document", purpose)?.status, `${site} ${purpose}`).toBe(403);
      }
    }
    expect(checkLocalRequest(req("HEAD", { host: "localhost:3000", "sec-fetch-site": "cross-site", "sec-fetch-dest": "document", "sec-purpose": "prefetch" }, "/reports/x"), LOCAL)?.status).toBe(403);
  });

  it("lets Next's own prefetch (same origin, with or without Sec-Purpose) and a plain cross-site navigation through", () => {
    expect(get("/reports/call_x", "same-origin", "empty", "prefetch")).toBeNull();
    expect(get("/reports/call_x", "same-origin", "document")).toBeNull();
    expect(get("/reports/call_x", undefined, undefined, "prefetch")).toBeNull();
    expect(get("/reports/call_x", "cross-site", "document", "prerender")).toBeNull();
    expect(get("/reports/call_x", "none", "document", "prefetch")).toBeNull();
  });

  it("applies to the /reports/ path only", () => {
    expect(get("/demo", "cross-site", "image")).toBeNull();
    expect(get("/reportsx/a", "cross-site", "image")).toBeNull();
  });
});
