// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeKey } from "./key-store";
import { BASE_URL_REFUSED, checkKey, createWebCall, listAgentsPage, localRetellBase, makeRetell, RETELL_API_BASE, storedRetell } from "./retell-source";

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

  it("takes OVERHEAR_RETELL_BASE_URL only in local mode, and only for a loopback http origin", () => {
    vi.stubEnv("OVERHEAR_RETELL_BASE_URL", "http://127.0.0.1:4555");
    // A hosted copy (no OVERHEAR_LOCAL) ignores it.
    expect(makeRetell(KEY).baseURL).toBe(RETELL_API_BASE);
    expect(localRetellBase()).toBeNull();
    vi.stubEnv("OVERHEAR_LOCAL", "0");
    expect(makeRetell(KEY).baseURL).toBe(RETELL_API_BASE);
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    expect(makeRetell(KEY).baseURL).toBe("http://127.0.0.1:4555");
    expect(localRetellBase()).toBe("http://127.0.0.1:4555");
    // An explicit base URL (a test's) still wins.
    expect(makeRetell(KEY, { baseURL: "http://127.0.0.1:1" }).baseURL).toBe("http://127.0.0.1:1");
  });

  it("in local mode, throws for an override that is not a plain loopback http origin, never falling back to Retell", () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    const refused = [
      "https://127.0.0.1:4555",
      "https://api.retellai.com",
      "http://attacker.example",
      "http://127.0.0.1.attacker.example:4555",
      "http://localhost.attacker.example",
      "http://attacker.example/@127.0.0.1",
      "http://127.0.0.1@attacker.example",
      "http://user:pw@127.0.0.1:4555",
      "http://127.0.0.1:4555/v2",
      "http://127.0.0.1:4555/?x=1",
      "http://127.0.0.1:4555/#x",
      "http://0.0.0.0:4555",
      "http://192.168.0.2:4555",
      "ftp://127.0.0.1",
      "127.0.0.1:4555",
      "not a url",
    ];
    for (const value of refused) {
      vi.stubEnv("OVERHEAR_RETELL_BASE_URL", value);
      expect(() => localRetellBase(), value).toThrow(BASE_URL_REFUSED);
      expect(() => makeRetell(KEY), value).toThrow(BASE_URL_REFUSED);
    }
    for (const value of ["http://localhost:9", "http://[::1]:9", "http://127.0.0.1"]) {
      vi.stubEnv("OVERHEAR_RETELL_BASE_URL", value);
      expect(localRetellBase(), value).not.toBeNull();
    }
    // The message holds neither the value (it may carry a password) nor the key.
    vi.stubEnv("OVERHEAR_RETELL_BASE_URL", "http://user:hunter2@attacker.example");
    try {
      makeRetell(KEY);
      expect.unreachable();
    } catch (err) {
      const text = String((err as Error).message) + String((err as Error).stack);
      expect(text).not.toContain("hunter2");
      expect(text).not.toContain("attacker");
      expect(text).not.toContain(KEY);
    }
    // An empty value is the same as unset (a bare `VAR=` line in .env).
    vi.stubEnv("OVERHEAR_RETELL_BASE_URL", "");
    expect(localRetellBase()).toBeNull();
    expect(makeRetell(KEY).baseURL).toBe(RETELL_API_BASE);
    // A hosted copy ignores a bad value instead of throwing.
    vi.stubEnv("OVERHEAR_LOCAL", "");
    vi.stubEnv("OVERHEAR_RETELL_BASE_URL", "https://attacker.example");
    expect(localRetellBase()).toBeNull();
    expect(makeRetell(KEY).baseURL).toBe(RETELL_API_BASE);
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

describe("listAgentsPage", () => {
  const agent = (id: string, name: unknown, extra: Record<string, unknown> = {}) => ({
    agent_id: id,
    agent_name: name,
    channel: "voice",
    response_engine: { type: "retell-llm", llm_id: "llm_SECRET" },
    webhook_url: "https://hooks.example/SECRET",
    voice_id: "v1",
    ...extra,
  });

  it("answers id and name only, voice agents only, built field by field, and one request", async () => {
    const { fn, seen } = fakeFetch(
      json(200, {
        items: [agent("agent_b", "zeta"), agent("agent_chat", "Chat bot", { channel: "chat" }), agent("agent_a", "alpha"), agent("agent_d", null), agent("bad id!", "x"), agent("agent_a", "dup")],
        has_more: false,
      }),
    );
    const out = await listAgentsPage(KEY, undefined, { fetch: fn });
    expect(out).toEqual({
      agents: [
        { id: "agent_b", name: "zeta" },
        { id: "agent_a", name: "alpha" },
        { id: "agent_d", name: "agent_d" },
      ],
      next: undefined,
    });
    expect(JSON.stringify(out)).not.toMatch(/SECRET|llm_|hooks/);
    expect(seen).toHaveLength(1);
    expect(new URL(seen[0].url).pathname).toBe("/v2/list-agents");
    expect(seen[0].headers.get("authorization")).toBe(`Bearer ${KEY}`);
  });

  it("sends the page key it is given, answers the next one only when there are more, and strips control characters from names", async () => {
    const { fn, seen } = fakeFetch(json(200, { items: [agent("agent_9", "Ni\u0000ne\n\u202Ex")], has_more: true, pagination_key: "k2" }), json(200, { items: [], has_more: true }));
    const out = await listAgentsPage(KEY, "k1", { fetch: fn });
    expect(out).toEqual({ agents: [{ id: "agent_9", name: "Nine x" }], next: "k2" });
    expect(new URL(seen[0].url).searchParams.get("pagination_key")).toBe("k1");
    // has_more with no key to follow is the end.
    expect((await listAgentsPage(KEY, undefined, { fetch: fn })).next).toBeUndefined();
  });

  it("gives an empty page for an answer with no items", async () => {
    expect(await listAgentsPage(KEY, undefined, { fetch: fakeFetch(json(200, {})).fn })).toEqual({ agents: [], next: undefined });
  });
});


describe("createWebCall", () => {
  const CALL = { access_token: "tok_abc", call_id: "call_web_1", transport: "gateway", ice_servers: [{ urls: ["stun:a.example"], username: "u", credential: "c", extra: "SECRET" }], agent_id: "agent_1", call_status: "registered", expires_at: 1, retell_llm_dynamic_variables: { a: "SECRET" } };

  it("posts the agent id and answers only the four connection fields", async () => {
    const { fn, seen } = fakeFetch(json(201, CALL));
    const out = await createWebCall(KEY, "agent_1", { fetch: fn });
    expect(out).toEqual({ callId: "call_web_1", accessToken: "tok_abc", transport: "gateway", iceServers: [{ urls: ["stun:a.example"], username: "u", credential: "c" }] });
    expect(JSON.stringify(out)).not.toContain("SECRET");
    expect(new URL(seen[0].url).pathname).toBe("/v3/create-web-call");
    expect(JSON.parse(seen[0].body)).toEqual({ agent_id: "agent_1" });
    expect(seen[0].url).not.toContain(KEY);
  });

  it("refuses an answer that is missing a field or has a field of the wrong type", async () => {
    for (const bad of [{ ...CALL, access_token: "" }, { ...CALL, call_id: "a b" }, { ...CALL, transport: "carrier-pigeon" }, { ...CALL, ice_servers: "x" }, { ...CALL, ice_servers: [{ urls: 5 }] }, null, "x"]) {
      await expect(createWebCall(KEY, "agent_1", { fetch: fakeFetch(json(201, bad)).fn }), JSON.stringify(bad)).rejects.toThrow("unreadable web call");
    }
  });

  it("lets an answer with no ice servers through as an empty list", async () => {
    const { ice_servers: _unused, ...rest } = CALL;
    void _unused;
    expect((await createWebCall(KEY, "agent_1", { fetch: fakeFetch(json(201, rest)).fn })).iceServers).toEqual([]);
  });
});
