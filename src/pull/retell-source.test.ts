// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeKey } from "./key-store";
import { checkKey, makeRetell, RETELL_API_BASE, storedRetell } from "./retell-source";

const KEY = "key_SOURCETEST0123456789abcdef";

type Seen = { url: string; method: string; headers: Headers; body: string };

/** A fake fetch that records each request and answers with the next scripted response. */
function fakeFetch(...answers: (() => Response)[]) {
  const seen: Seen[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: String(init?.body ?? "") });
    const next = answers.shift();
    if (!next) throw new Error("no scripted answer");
    return next();
  });
  return { fn: fn as unknown as typeof fetch, seen };
}

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const LIST_OK = json(200, { items: [], has_more: false });

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-source-"));
  vi.stubEnv("OVERHEAR_HOME", home);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("makeRetell", () => {
  it("never retries, never logs, and talks to Retell's own API by default", () => {
    vi.stubEnv("RETELL_BASE_URL", "https://attacker.example");
    vi.stubEnv("RETELL_LOG", "debug");
    const client = makeRetell(KEY);
    expect(client.maxRetries).toBe(0);
    expect(client.baseURL).toBe(RETELL_API_BASE);
    expect(client.logLevel).toBe("off");
    expect(RETELL_API_BASE).toBe("https://api.retellai.com");
  });

  it("sends the key only as a Bearer header, never in the URL", async () => {
    const { fn, seen } = fakeFetch(LIST_OK);
    await makeRetell(KEY, { fetch: fn, baseURL: "http://stub.test" }).call.list({ limit: 1 });
    expect(seen[0].url).not.toContain(KEY);
    expect(seen[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(seen[0].headers.get("cookie")).toBeNull();
  });
});

describe("checkKey", () => {
  it("makes one list request with limit 1 and says ok on 200", async () => {
    const { fn, seen } = fakeFetch(LIST_OK);
    expect(await checkKey(KEY, { fetch: fn })).toBe("ok");
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe("POST");
    expect(new URL(seen[0].url).pathname).toBe("/v3/list-calls");
    expect(new URL(seen[0].url).origin).toBe(RETELL_API_BASE);
    expect(JSON.parse(seen[0].body)).toEqual({ limit: 1 });
  });

  it("says bad_key on 401 and 403, with a single request each", async () => {
    for (const status of [401, 403]) {
      const { fn, seen } = fakeFetch(json(status, { message: "nope" }));
      expect(await checkKey(KEY, { fetch: fn }), String(status)).toBe("bad_key");
      expect(seen).toHaveLength(1);
    }
  });

  it("says unreachable on 429, 500 and a network failure, without retrying", async () => {
    const answers: (() => Response)[] = [json(429, {}), json(500, {}), () => { throw new TypeError("fetch failed"); }];
    for (const answer of answers) {
      const { fn, seen } = fakeFetch(answer);
      expect(await checkKey(KEY, { fetch: fn })).toBe("unreachable");
      expect(seen).toHaveLength(1);
    }
  });

  it("says bad_key for text that cannot be a key, without calling Retell", async () => {
    const { fn, seen } = fakeFetch();
    for (const bad of ["", "   ", "has space", "line\nbreak", "x".repeat(300)]) {
      expect(await checkKey(bad, { fetch: fn }), JSON.stringify(bad)).toBe("bad_key");
    }
    expect(seen).toHaveLength(0);
  });

  it("uses the global fetch when none is given", async () => {
    const { fn, seen } = fakeFetch(LIST_OK);
    vi.stubGlobal("fetch", fn);
    expect(await checkKey(KEY)).toBe("ok");
    expect(seen).toHaveLength(1);
  });
});

describe("storedRetell", () => {
  it("is null when no key is stored", async () => {
    expect(await storedRetell()).toBeNull();
  });

  it("builds the client from the stored key", async () => {
    await writeKey(KEY);
    const { fn, seen } = fakeFetch(LIST_OK);
    const client = await storedRetell({ fetch: fn });
    expect(client).not.toBeNull();
    await client!.call.list({ limit: 1 });
    expect(seen[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
    expect(client!.maxRetries).toBe(0);
  });
});
