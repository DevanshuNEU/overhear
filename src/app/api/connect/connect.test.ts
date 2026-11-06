// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configPath, readKey, writeKey } from "@/pull/key-store";
import { CONNECT_MESSAGE } from "@/pull/labels";
import { DELETE, GET, POST } from "./route";

const KEY = "key_ROUTETEST0123456789abcdef";
const HOST = "localhost:3000";
const ORIGIN = `http://${HOST}`;

let home: string;
let retell: { status: number; body: unknown } | "down";
let retellCalls = 0;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-connect-"));
  vi.stubEnv("OVERHEAR_HOME", home);
  vi.stubEnv("OVERHEAR_LOCAL", "1");
  vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3000");
  retell = { status: 200, body: { items: [], has_more: false } };
  retellCalls = 0;
  // Every Retell request in this file lands here; no test touches the network.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      retellCalls++;
      if (retell === "down") throw new TypeError("fetch failed");
      return new Response(JSON.stringify(retell.body), { status: retell.status, headers: { "content-type": "application/json" } });
    }),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
});

function post(body: unknown, headers: Record<string, string> = {}, url = "http://localhost:3000/api/connect") {
  return new Request(url, {
    method: "POST",
    headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const get = (headers: Record<string, string> = {}) => new Request("http://localhost:3000/api/connect", { headers: { host: HOST, ...headers } });
const del = (headers: Record<string, string> = {}) => new Request("http://localhost:3000/api/connect", { method: "DELETE", headers: { host: HOST, origin: ORIGIN, ...headers } });

describe("GET /api/connect", () => {
  it("says not connected when no key is stored", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false });
  });

  it("says connected, and nothing else, once a key is stored", async () => {
    await writeKey(KEY);
    const res = await GET(get());
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ connected: true });
    expect(text).not.toContain("ROUTETEST");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /api/connect", () => {
  it("stores a good key and answers only that it is connected", async () => {
    const res = await POST(post({ key: KEY }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ connected: true });
    expect(text).not.toContain("ROUTETEST");
    expect(await readKey()).toBe(KEY);
    expect(retellCalls).toBe(1);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("trims the pasted text before checking it", async () => {
    await POST(post({ key: `  ${KEY}\n` }));
    expect(await readKey()).toBe(KEY);
  });

  it("stores nothing for a bad key (Retell 401) and says so", async () => {
    retell = { status: 401, body: { message: "Invalid API key" } };
    const res = await POST(post({ key: KEY }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ connected: false, error: "bad_key", message: CONNECT_MESSAGE.bad_key });
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it("stores nothing when Retell cannot be reached and says so", async () => {
    for (const answer of ["down", { status: 500, body: {} }, { status: 429, body: {} }] as const) {
      retell = answer;
      const res = await POST(post({ key: KEY }));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ connected: false, error: "unreachable", message: CONNECT_MESSAGE.unreachable });
      expect(fs.existsSync(configPath())).toBe(false);
    }
  });

  it("keeps the key already stored when a new one fails the check", async () => {
    await writeKey(KEY);
    retell = { status: 401, body: {} };
    await POST(post({ key: "key_OTHER0123456789abcdef" }));
    expect(await readKey()).toBe(KEY);
  });

  it("answers 500 without the key when the key cannot be saved", async () => {
    const file = path.join(home, "a-file");
    fs.writeFileSync(file, "");
    vi.stubEnv("OVERHEAR_HOME", file);
    const res = await POST(post({ key: KEY }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ connected: false, error: "store_failed", message: CONNECT_MESSAGE.store_failed });
  });

  it("says the store directory is unsafe, and stores nothing, when other users can open it", async () => {
    fs.chmodSync(home, 0o755);
    const res = await POST(post({ key: KEY }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ connected: false, error: "home_unsafe", message: CONNECT_MESSAGE.home_unsafe });
    expect(fs.existsSync(configPath())).toBe(false);
    expect((fs.statSync(home).mode & 0o777).toString(8)).toBe("755");
  });

  it("refuses a body that is not JSON, not an object, has no key or is too large, without calling Retell", async () => {
    const cases: [Request, number][] = [
      [post(`{"key": ${KEY}`), 400],
      [post([KEY]), 400],
      [post({}), 400],
      [post({ key: 42 }), 400],
      [post({ key: "" }), 400],
      [post({ key: KEY }, { "content-type": "text/plain" }), 415],
      [post({ key: KEY, pad: "x".repeat(20_000) }), 413],
    ];
    for (const [req, status] of cases) {
      const res = await POST(req);
      expect(res.status).toBe(status);
      expect(await res.text()).not.toContain("ROUTETEST");
    }
    expect(retellCalls).toBe(0);
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it("never reads the key from the URL or a cookie", async () => {
    const res = await POST(post({}, { cookie: `key=${KEY}` }, `http://localhost:3000/api/connect?key=${KEY}`));
    expect(res.status).toBe(400);
    expect(retellCalls).toBe(0);
    expect(fs.existsSync(configPath())).toBe(false);
  });
});

describe("GET /api/connect with an unsafe key file", () => {
  it("says so instead of reading it", async () => {
    await writeKey(KEY);
    fs.chmodSync(configPath(), 0o644);
    const res = await GET(get());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ connected: false, error: "file_unsafe", message: CONNECT_MESSAGE.file_unsafe });
    expect(text).not.toContain("ROUTETEST");
  });
});

describe("DELETE /api/connect", () => {
  it("removes the stored key", async () => {
    await writeKey(KEY);
    const res = await DELETE(del());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ connected: false });
    expect(fs.existsSync(configPath())).toBe(false);
  });
});

describe("the route's own local check", () => {
  it("forbids framing on every answer, refusals included", async () => {
    const answers = [await GET(get()), await POST(post({ key: KEY })), await DELETE(del()), await GET(get({ host: "evil.com" })), await POST(post("nope"))];
    for (const res of answers) {
      expect(res.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    }
  });

  it("refuses everything when Next has not said the server is on 127.0.0.1", async () => {
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "");
    expect((await GET(get())).status).toBe(403);
    expect((await POST(post({ key: KEY }))).status).toBe(403);
    expect(retellCalls).toBe(0);
  });

  it("answers 404 on every method when OVERHEAR_LOCAL is unset, and stores nothing", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "");
    await writeKey(KEY);
    expect((await GET(get())).status).toBe(404);
    expect((await POST(post({ key: "key_NEW0123456789abcdef" }))).status).toBe(404);
    expect((await DELETE(del())).status).toBe(404);
    expect(await readKey()).toBe(KEY);
    expect(retellCalls).toBe(0);
  });

  it("refuses a foreign Host", async () => {
    expect((await GET(get({ host: "evil.com" }))).status).toBe(403);
    expect((await POST(post({ key: KEY }, { host: "evil.com:3000", origin: "http://evil.com:3000" }))).status).toBe(403);
    expect(fs.existsSync(configPath())).toBe(false);
  });

  it("refuses a POST or DELETE from another origin, so a web page cannot set or remove the key", async () => {
    await writeKey(KEY);
    for (const origin of ["http://evil.com", "null", "http://localhost:3001"]) {
      expect((await POST(post({ key: "key_EVIL0123456789abcdef" }, { origin }))).status, origin).toBe(403);
      expect((await DELETE(del({ origin }))).status, origin).toBe(403);
    }
    expect(await readKey()).toBe(KEY);
    expect(retellCalls).toBe(0);
  });
});
