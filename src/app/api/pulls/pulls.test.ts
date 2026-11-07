// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as refetch } from "@/app/api/calls/[id]/refetch/route";
import { writeKey } from "@/pull/key-store";
import { whenSettled } from "@/pull/pull";
import { POST as cancel } from "./[id]/cancel/route";
import { GET as progress } from "./[id]/route";
import { POST as start } from "./route";

const KEY = "key_PULLROUTE0123456789abcdef";
const HOST = "localhost:3000";
const ORIGIN = `http://${HOST}`;

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-pulls-"));
  vi.stubEnv("OVERHEAR_HOME", home);
  vi.stubEnv("OVERHEAR_LOCAL", "1");
  vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3000");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const body = url.pathname === "/v3/list-calls" ? { items: [{ call_id: "c1", call_status: "ended", start_timestamp: 1, access_token: "tok_SECRET" }], has_more: false } : { call_id: "c1" };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
  (globalThis as { __overhearPulls?: unknown }).__overhearPulls = undefined;
});

const post = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000${url}`, { method: "POST", headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (url: string, headers: Record<string, string> = {}) => new Request(`http://localhost:3000${url}`, { headers: { host: HOST, ...headers } });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("pull routes", () => {
  it("the pull and refetch routes answer 404 when OVERHEAR_LOCAL is unset", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "");
    expect((await start(post("/api/pulls", { n: 5 }))).status).toBe(404);
    expect((await progress(get("/api/pulls/x"), ctx("x"))).status).toBe(404);
    expect((await cancel(post("/api/pulls/x/cancel"), ctx("x"))).status).toBe(404);
    expect((await refetch(post("/api/calls/x/refetch"), ctx("x"))).status).toBe(404);
  });

  it("refuses a foreign host and a change without a same-origin Origin", async () => {
    await writeKey(KEY);
    expect((await start(post("/api/pulls", {}, { host: "evil.com" }))).status).toBe(403);
    expect((await start(post("/api/pulls", {}, { origin: "http://evil.com" }))).status).toBe(403);
    expect((await progress(get("/api/pulls/x", { host: "evil.com" }), ctx("x"))).status).toBe(403);
  });

  it("answers 409 when no key is stored", async () => {
    const res = await start(post("/api/pulls", { n: 5 }));
    expect(res.status).toBe(409);
  });

  it("rejects a count that is not a whole number from 1 to 100", async () => {
    await writeKey(KEY);
    for (const n of [0, 101, 2.5, "9", null]) expect((await start(post("/api/pulls", { n }))).status, String(n)).toBe(400);
  });

  it("starts a pull, reports progress, and the polled response never contains the key or a token", async () => {
    await writeKey(KEY);
    const res = await start(post("/api/pulls", { n: 5 }));
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    await whenSettled(id);
    const poll = await progress(get(`/api/pulls/${id}`), ctx(id));
    const text = await poll.text();
    expect(poll.status).toBe(200);
    expect(poll.headers.get("cache-control")).toBe("no-store");
    expect(text).not.toContain("PULLROUTE");
    expect(text).not.toContain("tok_SECRET");
    expect(JSON.parse(text)).toMatchObject({ id, phase: "done", listed: 1, rows: [{ callId: "c1" }] });
  });

  it("answers 404 for an unknown pull and cancels a known one", async () => {
    await writeKey(KEY);
    expect((await progress(get("/api/pulls/nope"), ctx("nope"))).status).toBe(404);
    expect((await cancel(post("/api/pulls/nope/cancel"), ctx("nope"))).status).toBe(404);
    const { id } = (await (await start(post("/api/pulls", { n: 5 }))).json()) as { id: string };
    expect((await cancel(post(`/api/pulls/${id}/cancel`), ctx(id))).status).toBe(200);
    await whenSettled(id);
  });

  it("refetches one call that is in the store, and 404s one that is not", async () => {
    await writeKey(KEY);
    const { id } = (await (await start(post("/api/pulls", { n: 5 }))).json()) as { id: string };
    await whenSettled(id);
    const res = await refetch(post("/api/calls/c1/refetch"), ctx("c1"));
    expect(res.status).toBe(200);
    // The record holds no transcript, so the real engine says no_content.
    expect(await res.json()).toEqual({ callId: "c1", state: "no_content" });
    expect((await refetch(post("/api/calls/zzz/refetch"), ctx("zzz"))).status).toBe(404);
  });

  it("answers 409 with the running pull's id when a pull is already active", async () => {
    await writeKey(KEY);
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => (open = r));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        await gate;
        const body = url.pathname === "/v3/list-calls" ? { items: [], has_more: false } : {};
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    const first = await start(post("/api/pulls", { n: 5 }));
    expect(first.status).toBe(202);
    const { id } = (await first.json()) as { id: string };
    const second = await start(post("/api/pulls", { n: 5 }));
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "pull_running", id });
    open();
    await whenSettled(id);
    expect((await start(post("/api/pulls", { n: 5 }))).status).toBe(202);
  });

  it("refetch answers the same safe error as a pull when the key store fails", async () => {
    await writeKey(KEY);
    const { id } = (await (await start(post("/api/pulls", { n: 5 }))).json()) as { id: string };
    await whenSettled(id);
    fs.chmodSync(path.join(home, "config.json"), 0o644);
    const res = await refetch(post("/api/calls/c1/refetch"), ctx("c1"));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "failed" });
    expect(text).not.toContain("PULLROUTE");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
