// @vitest-environment node
// Disconnect ends everything that holds the key or what the key fetched: a running pull stops, and the pulls and
// the calls they kept are dropped from memory, so the saved key and the data it read leave together.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as progress } from "@/app/api/pulls/[id]/route";
import type { Outcome } from "@/engine/types";
import { writeKey } from "@/pull/key-store";
import { activePullId, getOutcome, getProgress, startPull, whenSettled } from "@/pull/pull";
import { DELETE } from "./route";

const KEY = "key_DISCONNECT0123456789abcdef";
const HOST = "localhost:3000";
const ORIGIN = `http://${HOST}`;

let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-disconnect-"));
  vi.stubEnv("OVERHEAR_HOME", home);
  vi.stubEnv("OVERHEAR_LOCAL", "1");
  vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3000");
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
  (globalThis as { __overhearPulls?: unknown }).__overhearPulls = undefined;
});

const del = () => new Request("http://localhost:3000/api/connect", { method: "DELETE", headers: { host: HOST, origin: ORIGIN } });
const poll = (id: string) => progress(new Request(`http://localhost:3000/api/pulls/${id}`, { headers: { host: HOST } }), { params: Promise.resolve({ id }) });

const analyze = (raw: unknown): Outcome => ({ kind: "no_content", callId: (raw as { call_id: string }).call_id, reason: "no_transcript" });

/** A Retell that lists `n` calls at once and holds every get-call until the test lets them go. */
function slowRetell(n: number) {
  const requested: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const fn = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requested.push(url.pathname);
    if (url.pathname === "/v3/list-calls") {
      const items = Array.from({ length: n }, (_, i) => ({ call_id: `call_${i}`, call_status: "ended", start_timestamp: 1000 + i, duration_ms: 5000 }));
      return new Response(JSON.stringify({ items, has_more: false }), { status: 200, headers: { "content-type": "application/json" } });
    }
    await gate;
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    return new Response(JSON.stringify({ call_id: id, transcript: "hello" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const gets = () => requested.filter((p) => p !== "/v3/list-calls").length;
  return { fn, release: () => release(), gets };
}

describe("DELETE /api/connect with a pull running", () => {
  it("stops the pull, so no further request goes to Retell once the key is gone", async () => {
    await writeKey(KEY);
    const retell = slowRetell(12);
    const id = startPull({ n: 12, analyze, key: KEY, fetch: retell.fn, baseURL: "http://stub.test" });
    await vi.waitFor(() => expect(retell.gets()).toBe(5));
    expect(activePullId()).toBe(id);

    expect((await DELETE(del())).status).toBe(200);
    expect(activePullId()).toBeNull();

    const before = retell.gets();
    retell.release();
    await whenSettled(id).catch(() => {});
    await new Promise((r) => setTimeout(r, 20));
    expect(retell.gets()).toBe(before);
  });

  it("drops the pulls and the calls they kept, so the old pull id answers 404 and no call is held", async () => {
    await writeKey(KEY);
    const retell = slowRetell(2);
    const id = startPull({ n: 2, analyze, key: KEY, fetch: retell.fn, baseURL: "http://stub.test" });
    retell.release();
    await whenSettled(id);
    expect(getProgress(id)?.phase).toBe("done");
    expect(getOutcome("call_0")).not.toBeNull();
    expect((await poll(id)).status).toBe(200);

    expect((await DELETE(del())).status).toBe(200);

    expect((await poll(id)).status).toBe(404);
    expect(getProgress(id)).toBeNull();
    expect(getOutcome("call_0")).toBeNull();
  });

  it("still removes the key when no pull was ever started", async () => {
    await writeKey(KEY);
    expect((await DELETE(del())).status).toBe(200);
  });
});
