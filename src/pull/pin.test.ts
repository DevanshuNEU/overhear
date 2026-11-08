// @vitest-environment node
// pinCall without HTTP: Retell's failures, the shared limiter, and a trim that loses the call id.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinnedDir } from "@/pinned/store";
import { recordOf } from "@/pinned/testing";
import { failedSample } from "@/report/samples";
import { writeKey } from "./key-store";
import { pinCall } from "./pin";

const KEY = "key_PINUNIT0123456789abcdef";
const CALL = "call_8f2a9c";
const ASK = { callId: CALL, keep: { contracts: [], experience: [] } };
const TUNING = { sleep: async () => {}, jitter: () => 0 };

let home: string;
let answers: (() => Response)[];
let count: number;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-pin-unit-"));
  vi.stubEnv("OVERHEAR_HOME", home);
  count = 0;
  answers = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      count++;
      return (answers.shift() ?? (() => Response.json(recordOf(failedSample, CALL))))();
    }),
  );
  (globalThis as { __overhearPulls?: unknown }).__overhearPulls = undefined;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("@/pinned/minimize");
  vi.resetModules();
  fs.rmSync(home, { recursive: true, force: true });
  (globalThis as { __overhearPulls?: unknown }).__overhearPulls = undefined;
});

describe("pinCall and Retell", () => {
  it("maps Retell's failures to plain codes and writes nothing", async () => {
    await writeKey(KEY);
    const cases: [number, string][] = [
      [404, "not_found"],
      [401, "bad_key"],
      [403, "bad_key"],
    ];
    for (const [code, expected] of cases) {
      answers = [() => new Response("x", { status: code })];
      expect(await pinCall(ASK, { tuning: TUNING }), String(code)).toEqual({ ok: false, code: expected });
    }
    // 429 and 500 are retried by the pool and then reported.
    answers = Array.from({ length: 6 }, () => () => new Response("x", { status: 429 }));
    expect(await pinCall(ASK, { tuning: TUNING })).toEqual({ ok: false, code: "rate_limited" });
    answers = Array.from({ length: 6 }, () => () => new Response("x", { status: 500 }));
    expect(await pinCall(ASK, { tuning: TUNING })).toEqual({ ok: false, code: "retell_down" });
    const drop = () => {
      throw new TypeError("fetch failed");
    };
    answers = [drop, drop];
    expect(await pinCall(ASK, { tuning: TUNING })).toEqual({ ok: false, code: "network" });
    expect(fs.existsSync(pinnedDir())).toBe(false);
  });

  it("goes through the pull's shared limiter: a 429 from a pin starts the shared pause", async () => {
    await writeKey(KEY);
    let slept = 0;
    answers = [() => new Response("x", { status: 429 })];
    const res = await pinCall(ASK, {
      tuning: {
        sleep: async () => {
          slept++;
        },
        jitter: () => 0,
      },
    });
    expect(res.ok).toBe(true);
    expect(slept).toBeGreaterThan(0);
    expect(count).toBe(2);
    const limiter = (globalThis as { __overhearPulls?: { limiter: { inflight: number } } }).__overhearPulls?.limiter;
    expect(limiter?.inflight).toBe(0);
  });

  it("makes one request for one pin", async () => {
    await writeKey(KEY);
    expect((await pinCall(ASK, { tuning: TUNING })).ok).toBe(true);
    expect(count).toBe(1);
  });
});

describe("a trim that loses the call id", () => {
  it("is refused and writes nothing", async () => {
    vi.resetModules();
    vi.doMock("@/pinned/minimize", () => ({ minimizeRecord: () => ({}) }));
    const { pinCall: fresh } = await import("./pin");
    const { writeKey: write } = await import("./key-store");
    await write(KEY);
    expect(await fresh(ASK, { tuning: TUNING })).toEqual({ ok: false, code: "unreadable" });
    expect(fs.existsSync(pinnedDir())).toBe(false);
  });
});
