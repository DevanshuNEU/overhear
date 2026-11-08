// @vitest-environment node
// The most important test for the pasted key: a fake key carrying a unique marker goes through every path that
// touches it (connect, a key Retell refuses, rate limits, Retell down, the network failing, a successful check,
// disconnect, and the error paths), against a fake Retell that echoes the key back in every answer. The key must
// never show up in a response body or header, a cookie, a URL, a log line, stdout, stderr, or a thrown error.
//
// The whole flow runs twice: once with a `key_...` key, and once with a key that has no `key_` prefix, because
// redact() strips anything shaped like `key_...` and the test must not pass on that alone. The search looks for
// the key in plain text, hex and base64 (at every byte alignment, so a key inside a longer encoded string is
// found too), as Basic auth (`user:key` in base64), and as any 8-character window of the key or its marker
// (the forms are in canary-forms.ts).
//
// Pinning a call (src/pull/pin.ts) re-fetches it with the key, so it runs here too: against a Retell that echoes the key
// into every field of the call, transcript and tool data included (the pin is refused and nothing is written), and into
// every field the pin drops (the pin is saved and no file on disk holds the key but the key file).
//
// This calls the route handlers directly and never runs Next. `npm run canary:live` (scripts/canary-live.ts) runs
// the same search against a real `next dev`, which adds Next's request log, error overlay and .next/ cache.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/connect/route";
import { DELETE as pinsDelete, GET as pinsGet, POST as pinsPost } from "@/app/api/pins/route";
import { pinnedDir } from "@/pinned/store";
import { recordOf } from "@/pinned/testing";
import { failedSample } from "@/report/samples";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";
import { configPath, hasKey, readKey, removeKey, writeKey } from "./key-store";
import { type Canary, forms } from "./canary-forms";
import { logSafe, safeError } from "./redact";
import { checkKey, storedRetell } from "./retell-source";

const HOST = "127.0.0.1:4100";
const ORIGIN = `http://${HOST}`;

type LabeledCanary = Canary & { label: string };

const CANARIES: LabeledCanary[] = [
  { label: "a key_ key", key: "key_CANARY9f3b7c1d2e5a", marker: "CANARY9f3b7c1d2e5a" },
  { label: "a key with no key_ prefix", key: "Zq7CANARYb4e8a1f6c3d9W", marker: "Zq7CANARYb4e8a1f6c3d9W" },
];

type Answer = { status: number } | "network";

let canary: LabeledCanary;
let home: string;
let captured: string[];
let answers: Answer[];
let retellUrls: string[];
let retellCookies: string[];

function capture(...parts: unknown[]) {
  captured.push(parts.map((p) => (typeof p === "string" ? p : inspect(p, { depth: 10, showHidden: true }))).join(" "));
}

/** Records everything a response exposes: status line, every header (cookies included) and the body. */
async function record(res: Response) {
  const headers = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n");
  captured.push(`${res.status}\n${headers}\n${res.headers.getSetCookie().join("\n")}\n${await res.text()}`);
}

/** Runs a step, keeping anything it throws (message, stack, cause and own properties). */
async function step<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    capture("THROWN", err, err instanceof Error ? err.stack : "", err instanceof Error ? err.cause : "");
    return undefined;
  }
}

/** A fake Retell that puts the key it was sent into its body and its headers, like the worst real server could. */
function fakeRetell(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  retellUrls.push(String(input));
  const sent = new Headers(init?.headers);
  retellCookies.push(sent.get("cookie") ?? "");
  const answer = answers.shift() ?? { status: 200 };
  if (answer === "network") {
    return Promise.reject(new TypeError(`fetch failed for ${String(input)} with ${sent.get("authorization")}`));
  }
  const echo = sent.get("authorization") ?? "";
  const body =
    answer.status === 200
      ? { items: [], has_more: false, note: echo }
      : { message: `rejected ${echo}`, key: canary.key, hex: Buffer.from(canary.key).toString("hex"), b64: Buffer.from(canary.key).toString("base64") };
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: answer.status,
      headers: { "content-type": "application/json", "x-echo": echo, "retry-after": "1", "set-cookie": `k=${canary.key}` },
    }),
  );
}

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request(`http://${HOST}/api/connect`, { method: "POST", headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", ...headers }, body });
const postKey = (key: string) => post(JSON.stringify({ key }));
const get = () => new Request(`http://${HOST}/api/connect`, { headers: { host: HOST } });
const del = () => new Request(`http://${HOST}/api/connect`, { method: "DELETE", headers: { host: HOST, origin: ORIGIN } });

function startCapture() {
  captured = [];
  answers = [];
  retellUrls = [];
  retellCookies = [];
  vi.stubGlobal("fetch", vi.fn(fakeRetell));
  for (const method of ["log", "info", "warn", "error", "debug", "trace", "dir", "table"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => capture(`console.${method}`, ...args));
  }
  // Pass through so vitest's own reporter still works, but keep a copy of every byte.
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, ...rest: never[]) => {
    capture("stdout", String(chunk));
    return out(chunk as string, ...rest);
  }) as typeof process.stdout.write);
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown, ...rest: never[]) => {
    capture("stderr", String(chunk));
    return err(chunk as string, ...rest);
  }) as typeof process.stderr.write);
}

/** The captured text that holds any form of the current key. */
function leaks(): string[] {
  const search = forms(canary);
  return [...captured, ...retellUrls, ...retellCookies].filter((text) => search.some((f) => text.includes(f)));
}

function expectNoCanary() {
  expect(leaks()).toEqual([]);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

describe("the canary search", () => {
  beforeEach(() => {
    canary = CANARIES[1];
    captured = [];
    retellUrls = [];
    retellCookies = [];
  });

  it("finds the key in plain text, hex, base64 at any alignment, Basic auth and any 8-character window", () => {
    const { key } = canary;
    const found = (text: string) => {
      captured = [text];
      return leaks().length > 0;
    };
    expect(found(`x ${key} y`)).toBe(true);
    expect(found(Buffer.from(key).toString("hex"))).toBe(true);
    expect(found(Buffer.from(key).toString("hex").toUpperCase())).toBe(true);
    for (const prefix of ["", "a", "ab", "abc", "Bearer ", "user:", "some longer prefix:"]) {
      expect(found(Buffer.from(prefix + key + " tail").toString("base64")), prefix).toBe(true);
      expect(found(Buffer.from(prefix + key).toString("base64url")), prefix).toBe(true);
    }
    expect(found(`Authorization: Basic ${Buffer.from(`user:${key}`).toString("base64")}`)).toBe(true);
    expect(found(`..."${key.slice(3, 11)}"...`)).toBe(true);
    expect(found("nothing to see here, Bearer [redacted]")).toBe(false);
  });
});

describe.each(CANARIES)("a canary key never appears anywhere: $label", (c) => {
  beforeEach(() => {
    canary = c;
    home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-canary-"));
    vi.stubEnv("OVERHEAR_HOME", path.join(home, "store"));
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    vi.stubEnv("__NEXT_PRIVATE_ORIGIN", `http://${HOST}`);
    startCapture();
  });

  it("is a key redact() does not recognise by its shape, for the second run", () => {
    if (!c.key.startsWith("key_")) expect(/\bkey_/.test(c.key)).toBe(false);
  });

  it("the capture sees console, stdout, stderr and logSafe output", () => {
    logSafe("canary.self_check", { n: 1 });
    process.stderr.write("");
    expect(captured.some((line) => line.includes("canary.self_check"))).toBe(true);
  });

  it("through connect, a refused key, rate limits, Retell down, the network failing, a good check and disconnect", async () => {
    const key = c.key;
    // A key Retell refuses, then 403, 429, 500 and a network failure: nothing is stored and nothing leaks.
    for (const answer of [{ status: 401 }, { status: 403 }, { status: 429 }, { status: 500 }, { status: 503 }, "network"] as Answer[]) {
      answers = [answer];
      const res = await step(() => POST(postKey(key)));
      expect(res, JSON.stringify(answer)).toBeDefined();
      await record(res!);
      expect(await hasKey()).toBe(false);
    }
    // The failures above were logged, so the capture had something to look at.
    expect(captured.some((line) => line.includes("connect.check_failed"))).toBe(true);

    // A good key: stored, then reported as connected.
    answers = [{ status: 200 }];
    await record((await step(() => POST(postKey(key))))!);
    expect(await readKey()).toBe(key);
    await record((await step(() => GET(get())))!);

    // The stored client, used against a Retell that answers 401 with the key in its body.
    answers = [{ status: 401 }];
    const client = await storedRetell();
    await step(async () => {
      try {
        await client!.call.list({ limit: 1 });
      } catch (err) {
        // What src/pull hands on from an SDK error: only this.
        capture("safeError", safeError(err));
      }
    });

    // Disconnect.
    await record((await step(() => DELETE(del())))!);
    expect(fs.existsSync(configPath())).toBe(false);
    await record((await step(() => GET(get())))!);

    expect(retellUrls.length).toBeGreaterThanOrEqual(8);
    expectNoCanary();
  });

  it("through checkKey directly, for every answer", async () => {
    for (const answer of [{ status: 200 }, { status: 401 }, { status: 429 }, { status: 500 }, "network"] as Answer[]) {
      answers = [answer];
      capture("result", await step(() => checkKey(c.key)));
    }
    expectNoCanary();
  });

  it("through the error paths: bad JSON, bad keys, an unsafe or broken store, damaged and loose key files", async () => {
    const key = c.key;
    const store = path.join(home, "store");
    // A body that is not JSON, with the key inside: the parser's message would quote it.
    for (const body of [key, `{"key": ${key}`, `{"key": "${key}`, `{"key": "${key}"`]) {
      await record((await step(() => POST(post(body))))!);
    }
    // Text with a newline cannot be a key, and the refusal must not quote it.
    await record((await step(() => POST(postKey(`${key}\nmore`))))!);
    await step(() => writeKey(`${key} with space`));
    // The key in the URL and a cookie, which the route must ignore.
    const sneaky = new Request(`http://${HOST}/api/connect?key=${key}`, {
      method: "POST",
      headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", cookie: `key=${key}` },
      body: "{}",
    });
    await record((await step(() => POST(sneaky)))!);

    // The store's directory is a file, so saving fails after Retell said yes.
    fs.writeFileSync(store, "");
    answers = [{ status: 200 }];
    await record((await step(() => POST(postKey(key))))!);
    await step(() => writeKey(key));
    await step(() => removeKey());
    fs.rmSync(store);

    // The store's directory is open to other users, so Overhear refuses it.
    fs.mkdirSync(store);
    fs.chmodSync(store, 0o755);
    answers = [{ status: 200 }];
    await record((await step(() => POST(postKey(key))))!);
    await step(() => writeKey(key));
    fs.chmodSync(store, 0o700);

    // A damaged config file that holds the key: JSON.parse would quote it in its message.
    for (const damaged of [key, `{"retellApiKey": ${key}`, `{"retellApiKey": "${key}`, `{"retellApiKey": "${key}" "x"}`]) {
      fs.writeFileSync(configPath(), damaged, { mode: 0o600 });
      fs.chmodSync(configPath(), 0o600);
      capture("readKey", await step(() => readKey()));
      capture("storedRetell is null", (await step(() => storedRetell())) === null);
      await record((await step(() => GET(get())))!);
    }

    // A good key file other users can read, and one behind a symlink: refused without being read out.
    fs.writeFileSync(configPath(), JSON.stringify({ retellApiKey: key }));
    fs.chmodSync(configPath(), 0o644);
    await step(() => readKey());
    await step(() => storedRetell());
    await record((await step(() => GET(get())))!);
    fs.rmSync(configPath());
    const elsewhere = path.join(home, "elsewhere.json");
    fs.writeFileSync(elsewhere, JSON.stringify({ retellApiKey: key }), { mode: 0o600 });
    fs.symlinkSync(elsewhere, configPath());
    await step(() => readKey());
    await record((await step(() => GET(get())))!);
    await record((await step(() => DELETE(del())))!);

    // Bearer text in a log field is redacted whatever the key looks like.
    logSafe("canary.bearer", { header: `Bearer ${key}` });

    expectNoCanary();
  });

  it("through pinning a call: the key echoed into every field of the call, then only into the fields a pin drops", async () => {
    const key = c.key;
    const echoed = (callId: string, where: "everywhere" | "dropped"): unknown => {
      const rec = recordOf(failedSample, callId) as Record<string, unknown> & { transcript_with_tool_calls: Record<string, unknown>[] };
      const dropped = {
        access_token: key,
        recording_url: `https://recordings.example/${key}`,
        public_log_url: `https://logs.example/${encodeURIComponent(key)}`,
        from_number: key,
        metadata: { key, hex: Buffer.from(key).toString("hex") },
        retell_llm_dynamic_variables: { key },
        call_analysis: { call_summary: key, custom_analysis_data: { key } },
      };
      Object.assign(rec, dropped);
      if (where === "everywhere") {
        for (const turn of rec.transcript_with_tool_calls) {
          for (const field of ["content", "arguments"]) if (typeof turn[field] === "string") turn[field] = `${turn[field]} ${key}`;
        }
        rec.agent_id = key.replace(/[^A-Za-z0-9_-]/g, "_");
      }
      return rec;
    };
    let body: unknown;
    let status = 200;
    let drop = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        retellUrls.push(String(input));
        if (drop) throw new TypeError(`fetch failed for ${String(input)} with ${new Headers(init?.headers).get("authorization")}`);
        const sent = new Headers(init?.headers);
        retellCookies.push(sent.get("cookie") ?? "");
        const echo = sent.get("authorization") ?? "";
        return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-echo": echo, "set-cookie": `k=${key}` } });
      }),
    );
    const pinsRequest = (method: string, payload?: unknown, path_ = "") =>
      new Request(`http://${HOST}/api/pins${path_}`, {
        method,
        headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    const ask = (callId: string, note?: string) => ({ callId, keep: { contracts: ["transfer_kept"], experience: ["agent_ends_call"] }, ...(note ? { note } : {}) });
    const pinned = () => (fs.existsSync(pinnedDir()) ? fs.readdirSync(pinnedDir()) : []);
    await writeKey(key);

    // The key in the transcript and tool data: refused, and nothing is written.
    body = echoed("call_canary_a", "everywhere");
    const refused = (await step(() => pinsPost(pinsRequest("POST", ask("call_canary_a")))))!;
    expect(refused.status).toBe(409);
    expect(((await refused.clone().json()) as { error: string }).error).toBe("key_in_call");
    await record(refused);
    expect(pinned()).toEqual([]);

    // The key in the note: refused too.
    body = echoed("call_canary_b", "dropped");
    const noted = (await step(() => pinsPost(pinsRequest("POST", ask("call_canary_b", `see ${key}`)))))!;
    expect(noted.status).toBe(409);
    expect(((await noted.clone().json()) as { error: string }).error).toBe("key_in_call");
    await record(noted);
    expect(pinned()).toEqual([]);

    // The key only in what a pin drops: saved, listed and deleted without the key in any file or answer.
    const saved = (await step(() => pinsPost(pinsRequest("POST", ask("call_canary_b")))))!;
    expect(saved.status).toBe(200);
    await record(saved);
    expect(pinned()).toHaveLength(1);
    await record((await step(() => pinsGet(new Request(`http://${HOST}/api/pins`, { headers: { host: HOST } }))))!);
    const held = fs.readdirSync(home, { recursive: true }) as string[];
    for (const rel of held) {
      const file = path.join(home, rel);
      if (!fs.statSync(file).isFile() || file === configPath()) continue;
      captured.push(`file ${rel}: ${fs.readFileSync(file, "utf8")}`);
    }
    expect(captured.some((line) => line.startsWith("file store/pinned/pin-call-canary-b"))).toBe(true);

    // Retell refusing and not having the call, with the key in what it says. (429 and 500 wait and retry on a real clock;
    // src/pull/pin.test.ts covers them with an instant one.)
    for (const code of [401, 404]) {
      status = code;
      body = { message: `rejected ${key}`, key };
      const res = (await step(() => pinsPost(pinsRequest("POST", ask("call_canary_c")))))!;
      await record(res);
    }
    drop = true;
    await record((await step(() => pinsPost(pinsRequest("POST", ask("call_canary_c")))))!);
    status = 200;
    await record((await step(() => pinsDelete(pinsRequest("DELETE"))))!);
    expect(pinned()).toEqual([]);
    expectNoCanary();
  });

  it("through the proxy, which never echoes a request back", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    for (const host of [HOST, "evil.com"]) {
      for (const method of ["GET", "POST"]) {
        const req = new NextRequest(
          new Request(`http://${HOST}/api/connect?key=${c.key}`, { method, headers: { host, origin: `http://${c.key.toLowerCase()}.evil.com`, cookie: `k=${c.key}` } }),
        );
        const res = await proxy(req);
        const headers = [...res.headers.entries()];
        captured.push(`${res.status} ${JSON.stringify(headers)} ${await res.text()}`);
      }
    }
    expectNoCanary();
  });

  it("would catch a leak: the check fails when the key is captured", () => {
    captured.push(`oops ${c.key}`);
    expect(() => expectNoCanary()).toThrow();
    captured = [];
  });
});
