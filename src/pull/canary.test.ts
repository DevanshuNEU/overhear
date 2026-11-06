// @vitest-environment node
// The most important test for the pasted key: a fake key carrying a unique marker goes through every path that
// touches it (connect, a key Retell refuses, rate limits, Retell down, the network failing, a successful check,
// disconnect, and the error paths), against a fake Retell that echoes the key back in every answer. The marker
// must never show up in a response body or header, a cookie, a URL, a log line, stdout, stderr, or a thrown error.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/connect/route";
import { proxy } from "@/proxy";
import { NextRequest } from "next/server";
import { configPath, hasKey, readKey, removeKey, writeKey } from "./key-store";
import { logSafe, safeError } from "./redact";
import { checkKey, storedRetell } from "./retell-source";

const MARKER = "CANARY9f3b7c1d2e5a";
const CANARY = `key_${MARKER}`;
// A leak of part of the key counts too: JSON.parse quotes about ten characters of what it failed on.
const FRAGMENTS = [MARKER, "CANARY", "9f3b7c1d2e5a"];
const HOST = "127.0.0.1:4100";
const ORIGIN = `http://${HOST}`;

type Answer = { status: number } | "network";

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
  const body = answer.status === 200 ? { items: [], has_more: false, note: echo } : { message: `rejected ${echo}`, key: CANARY };
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: answer.status,
      headers: { "content-type": "application/json", "x-echo": echo, "retry-after": "1", "set-cookie": `k=${CANARY}` },
    }),
  );
}

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request(`http://${HOST}/api/connect`, { method: "POST", headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", ...headers }, body });
const postKey = (key: string) => post(JSON.stringify({ key }));
const get = () => new Request(`http://${HOST}/api/connect`, { headers: { host: HOST } });
const del = () => new Request(`http://${HOST}/api/connect`, { method: "DELETE", headers: { host: HOST, origin: ORIGIN } });

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-canary-"));
  vi.stubEnv("OVERHEAR_HOME", path.join(home, "store"));
  vi.stubEnv("OVERHEAR_LOCAL", "1");
  vi.stubEnv("__NEXT_PRIVATE_ORIGIN", `http://${HOST}`);
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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
});

function expectNoCanary() {
  const leaks = [...captured, ...retellUrls, ...retellCookies].filter((text) => FRAGMENTS.some((f) => text.includes(f)));
  expect(leaks).toEqual([]);
}

describe("a canary key never appears anywhere", () => {
  it("the capture sees console, stdout, stderr and logSafe output", () => {
    logSafe("canary.self_check", { n: 1 });
    process.stderr.write("");
    expect(captured.some((line) => line.includes("canary.self_check"))).toBe(true);
  });

  it("through connect, a refused key, rate limits, Retell down, the network failing, a good check and disconnect", async () => {
    // A key Retell refuses, then 403, 429, 500 and a network failure: nothing is stored and nothing leaks.
    for (const answer of [{ status: 401 }, { status: 403 }, { status: 429 }, { status: 500 }, { status: 503 }, "network"] as Answer[]) {
      answers = [answer];
      const res = await step(() => POST(postKey(CANARY)));
      expect(res, JSON.stringify(answer)).toBeDefined();
      await record(res!);
      expect(await hasKey()).toBe(false);
    }
    // The failures above were logged, so the capture had something to look at.
    expect(captured.some((line) => line.includes("connect.check_failed"))).toBe(true);

    // A good key: stored, then reported as connected.
    answers = [{ status: 200 }];
    await record((await step(() => POST(postKey(CANARY))))!);
    expect(await readKey()).toBe(CANARY);
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
      capture("result", await step(() => checkKey(CANARY)));
    }
    expectNoCanary();
  });

  it("through the error paths: bad JSON, a key with a newline, a store that cannot be written, a damaged file", async () => {
    // A body that is not JSON, with the key inside: the parser's message would quote it.
    for (const body of [CANARY, `{"key": ${CANARY}`, `{"key": "${CANARY}`, `{"key": "${CANARY}"`]) {
      await record((await step(() => POST(post(body))))!);
    }
    // Text with a newline cannot be a key, and the refusal must not quote it.
    await record((await step(() => POST(postKey(`${CANARY}\nmore`))))!);
    await step(() => writeKey(`${CANARY} with space`));
    // The key in the URL and a cookie, which the route must ignore.
    const sneaky = new Request(`http://${HOST}/api/connect?key=${CANARY}`, {
      method: "POST",
      headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", cookie: `key=${CANARY}` },
      body: "{}",
    });
    await record((await step(() => POST(sneaky)))!);

    // The store's directory is a file, so saving fails after Retell said yes.
    fs.writeFileSync(path.join(home, "store"), "");
    answers = [{ status: 200 }];
    await record((await step(() => POST(postKey(CANARY))))!);
    await step(() => writeKey(CANARY));
    await step(() => removeKey());
    fs.rmSync(path.join(home, "store"));

    // A damaged config file that holds the key: JSON.parse would quote it in its message.
    fs.mkdirSync(path.join(home, "store"), { mode: 0o700 });
    for (const damaged of [CANARY, `{"retellApiKey": ${CANARY}`, `{"retellApiKey": "${CANARY}`, `{"retellApiKey": "${CANARY}" "x"}`]) {
      fs.writeFileSync(configPath(), damaged, { mode: 0o600 });
      capture("readKey", await step(() => readKey()));
      capture("storedRetell is null", (await step(() => storedRetell())) === null);
      await record((await step(() => GET(get())))!);
    }

    // The key as a log field and an event name.
    logSafe(`event ${CANARY}`, { key: CANARY, header: `Bearer ${CANARY}` });

    expectNoCanary();
  });

  it("through the proxy, which never echoes a request back", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    for (const host of [HOST, "evil.com"]) {
      for (const method of ["GET", "POST"]) {
        const req = new NextRequest(new Request(`http://${HOST}/api/connect?key=${CANARY}`, { method, headers: { host, origin: `http://${CANARY}.evil.com`, cookie: `k=${CANARY}` } }));
        const res = await proxy(req);
        const headers = [...res.headers.entries()];
        captured.push(`${res.status} ${JSON.stringify(headers)} ${await res.text()}`);
      }
    }
    expectNoCanary();
  });

  it("would catch a leak: the check fails when the marker is captured", () => {
    captured.push(`oops ${CANARY}`);
    expect(() => expectNoCanary()).toThrow();
    captured = [];
  });
});
