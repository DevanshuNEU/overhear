// @vitest-environment node
// The pin routes: pin a call from the app, list pins, delete one or all. The key is stored on a temp home, the Retell
// API is a fake fetch that counts requests, and the call is the failed sample under a made-up id.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeRetellCall } from "@/engine/analyze";
import { parseCase } from "@/engine/eval/case";
import { writeKey } from "@/pull/key-store";
import { pinnedDir } from "@/pinned/store";
import { failedPin, marked, passedPin, agentRecordOf, sawOf } from "@/pinned/testing";
import { failedSample, passedSample } from "@/report/samples";
import pkg from "../../../../package.json";
import { DELETE as deleteOne } from "./[id]/route";
import { DELETE as deleteAll, GET, POST } from "./route";

const KEY = "key_PINROUTE0123456789abcdef";
const MARKER = "PINMARKER7d1e5b";
const HOST = "localhost:3000";
const ORIGIN = `http://${HOST}`;
const CALL = "call_8f2a9c";

let home: string;
let requests: string[];
let record: unknown;
let status: number;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-pins-"));
  vi.stubEnv("OVERHEAR_HOME", home);
  vi.stubEnv("OVERHEAR_LOCAL", "1");
  vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3000");
  requests = [];
  status = 200;
  record = { ...agentRecordOf(failedSample, CALL), access_token: "tok_SECRET", recording_url: "https://signed.example/rec?sig=abc", from_number: "+15555550100" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input));
      const body = status === 200 ? record : { message: `no ${MARKER}`, echo: MARKER };
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
  (globalThis as { __overhearPulls?: unknown }).__overhearPulls = undefined;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(home, { recursive: true, force: true });
  (globalThis as { __overhearPulls?: unknown }).__overhearPulls = undefined;
});

const url = (p = "") => `http://localhost:3000/api/pins${p}`;
const send = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(url(p), {
    method,
    headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
// What a client sends: the names to keep and what the screen showed for them.
const ASK = { callId: CALL, keep: { contracts: ["transfer_kept"], experience: [] as string[] }, saw: sawOf(agentRecordOf(failedSample, CALL)) };
const files = () => (fs.existsSync(pinnedDir()) ? fs.readdirSync(pinnedDir()) : []);
const read = async (res: Response) => ({ status: res.status, text: await res.clone().text(), body: (await res.json()) as Record<string, unknown> });

/** The failed sample with the stored key spoken in one agent turn. */
function withKeyInTranscript(key: string): unknown {
  const rec = agentRecordOf(failedSample, CALL) as { transcript_with_tool_calls: { content?: string }[] };
  const turn = rec.transcript_with_tool_calls.find((u) => typeof u.content === "string" && u.content !== "");
  if (!turn) throw new Error("the sample has no spoken turn");
  turn.content = `${turn.content} my key is ${key} ok`;
  return rec;
}

describe("local mode only", () => {
  it("answers 404 on every method when OVERHEAR_LOCAL is unset, with no Retell request", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "");
    await writeKey(KEY);
    expect((await POST(send("POST", "", ASK))).status).toBe(404);
    expect((await GET(send("GET", ""))).status).toBe(404);
    expect((await deleteAll(send("DELETE", ""))).status).toBe(404);
    expect((await deleteOne(send("DELETE", "/pin-x"), ctx("pin-x"))).status).toBe(404);
    expect(requests).toEqual([]);
  });

  it("refuses a foreign host and a change without a same-origin Origin (403), with no Retell request", async () => {
    await writeKey(KEY);
    expect((await POST(send("POST", "", ASK, { host: "evil.com" }))).status).toBe(403);
    expect((await POST(send("POST", "", ASK, { origin: "http://evil.com" }))).status).toBe(403);
    expect((await POST(send("POST", "", ASK, { origin: "null" }))).status).toBe(403);
    expect((await deleteAll(send("DELETE", "", undefined, { origin: "http://evil.com" }))).status).toBe(403);
    expect((await deleteOne(send("DELETE", "/pin-x", undefined, { origin: "http://evil.com" }), ctx("pin-x"))).status).toBe(403);
    expect((await GET(send("GET", "", undefined, { host: "evil.com" }))).status).toBe(403);
    expect(requests).toEqual([]);
    expect(files()).toEqual([]);
  });
});

describe("another site cannot make the server read the pins", () => {
  const from = (site: string, dest: string) => GET(send("GET", "", undefined, { "sec-fetch-site": site, "sec-fetch-dest": dest }));

  it("refuses a GET that another site or another port sends, as a fetch or as a page, and runs no check", async () => {
    fs.mkdirSync(pinnedDir(), { recursive: true, mode: 0o700 });
    const pin = failedPin(CALL);
    fs.writeFileSync(path.join(pinnedDir(), `${pin.id}.json`), JSON.stringify(pin), { mode: 0o600 });
    for (const site of ["cross-site", "same-site"]) {
      for (const dest of ["empty", "document", "script", "image"]) {
        const res = await from(site, dest);
        expect(res.status, `${site} ${dest}`).toBe(403);
        expect(await res.text()).not.toContain(CALL);
      }
    }
    expect((await GET(send("GET", "", undefined, { "sec-fetch-site": "cross-site", "sec-purpose": "prefetch" }))).status).toBe(403);
  });

  it("answers the page itself (same-origin), a typed address (none) and a client that sends no Fetch Metadata", async () => {
    expect((await from("same-origin", "empty")).status).toBe(200);
    expect((await from("none", "document")).status).toBe(200);
    expect((await GET(send("GET", ""))).status).toBe(200);
  });
});

describe("bad input never reaches Retell", () => {
  const bad = async (body: unknown, headers: Record<string, string> = {}) => {
    await writeKey(KEY);
    const res = await POST(send("POST", "", body, headers));
    expect(requests, "a Retell request was made").toEqual([]);
    expect(files()).toEqual([]);
    return read(res);
  };

  it("refuses a call id that is not a Retell id (400)", async () => {
    for (const callId of ["../etc/passwd", "a/b", "", "has space", "x".repeat(129), "call.id", 5, null, ["call_1"]]) {
      const r = await bad({ ...ASK, callId });
      expect(r.status, String(callId)).toBe(400);
      expect(r.body.error).toBe("bad_call_id");
    }
  });

  it("refuses an unknown keep name, a malformed keep and unknown fields (400)", async () => {
    for (const body of [
      { ...ASK, keep: { contracts: ["made_up"], experience: [] } },
      { ...ASK, keep: { contracts: [], experience: ["nope"] } },
      { ...ASK, keep: { contracts: "transfer_kept", experience: [] } },
      { ...ASK, keep: { contracts: [] } },
      { ...ASK, keep: undefined },
      { ...ASK, extra: 1 },
      { ...ASK, note: 5 },
      { ...ASK, note: "x".repeat(281) },
      { ...ASK, saw: { verdict: "failed" } },
      { callId: CALL, keep: ASK.keep },
      { ...ASK, saw: undefined },
      { ...ASK, saw: null },
    ]) {
      const r = await bad(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error).toBe("bad_request");
    }
    for (const body of [[ASK], "null", "5"]) {
      const r = await bad(body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("refuses a body that is not JSON (400), not declared as JSON (415) or over 4 KB (413)", async () => {
    expect((await bad("{ not json")).status).toBe(400);
    expect((await bad(JSON.stringify(ASK), { "content-type": "text/plain" })).status).toBe(415);
    expect((await bad({ ...ASK, note: "x".repeat(5000) })).status).toBe(413);
  });

  it("stops reading a body past 4 KB when it has no Content-Length (413)", async () => {
    await writeKey(KEY);
    let pulled = 0;
    const chunk = new TextEncoder().encode("x".repeat(1024));
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 5000) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const req = new Request(url(), { method: "POST", headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    expect(req.headers.get("content-length")).toBeNull();
    const r = await read(await POST(req));
    expect(r.status).toBe(413);
    expect(r.body.error).toBe("body_too_large");
    expect(pulled).toBeLessThan(20);
    expect(requests).toEqual([]);
    expect(files()).toEqual([]);
  });

  it("reads a body that arrives in several chunks and is within 4 KB", async () => {
    await writeKey(KEY);
    const text = new TextEncoder().encode(JSON.stringify(ASK));
    const parts = [text.slice(0, 10), text.slice(10, 50), text.slice(50)];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    });
    const req = new Request(url(), { method: "POST", headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    expect((await POST(req)).status).toBe(200);
  });

  it("says so when no key is stored: 409, no Retell request", async () => {
    const res = await POST(send("POST", "", ASK));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_connected");
    expect(requests).toEqual([]);
  });
});

describe("pinning a call", () => {
  it("saves a pin that passes parseCase, answers only the id and status, and keeps nothing the engine does not read", async () => {
    await writeKey(KEY);
    const res = await POST(send("POST", "", { ...ASK, keep: { contracts: ["transfer_kept"], experience: ["agent_ends_call"] }, note: "nurse\ntransfer\u001b[31m promised  never made‮" }));
    const { status: code, body, text } = await read(res);
    expect(code).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["id", "status"]);
    expect(text).not.toContain(KEY);
    expect(requests).toHaveLength(1);
    expect(files()).toEqual([`${body.id}.json`]);

    const file = path.join(pinnedDir(), `${body.id}.json`);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const saved = fs.readFileSync(file, "utf8");
    const pin = parseCase(JSON.parse(saved));
    expect(pin.id).toBe(body.id);
    expect(pin.pin).toMatchObject({ callId: CALL, pinnedWith: pkg.version });
    expect(pin.label.by).toBe("you");
    expect(pin.label.note).toBe("nurse transfer[31m promised never made");
    expect(pin.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(pin.locked).toBe(true);
    // A user's own agent has no demo preset, so the sample reads as the engine reads it for any agent.
    expect(pin.expect.verdict).toBe(ASK.saw.verdict);
    expect(pin.expect.contracts).toEqual({ transfer_kept: ASK.saw.contracts.transfer_kept });
    expect(Object.keys(pin.expect.experience ?? {})).toEqual(["agent_ends_call"]);
    for (const dropped of ["tok_SECRET", "signed.example", "+15555550100", "access_token", "from_number", KEY]) expect(saved).not.toContain(dropped);
  });

  it("strips every kind of character a pinned call's note may not hold, so the pin still parses", async () => {
    await writeKey(KEY);
    const hostile = ["\u0000", "\u0007", "\u001b", "\u007f", "\u0085", "\u009f", "\u200b", "\u200f", "\u2028", "\u2029", "\u202a", "\u202e", "\u2066", "\u2069", "\ufeff", "\u{e0041}"];
    const note = `a${hostile.join("b")}c`;
    const res = await POST(send("POST", "", { ...ASK, note }));
    expect(res.status).toBe(200);
    expect(parseCase(JSON.parse(fs.readFileSync(path.join(pinnedDir(), files()[0]), "utf8"))).label.note).toMatch(/^a[b ]+c$/);
  });

  it("keeps only the verdict when nothing else is ticked, and pinning the same call again replaces the pin", async () => {
    await writeKey(KEY);
    const first = await read(await POST(send("POST", "", { ...ASK, keep: { contracts: [], experience: [] } })));
    expect(first.status).toBe(200);
    expect(parseCase(JSON.parse(fs.readFileSync(path.join(pinnedDir(), files()[0]), "utf8"))).expect.contracts).toEqual({});
    const second = await read(await POST(send("POST", "", ASK)));
    expect(second.body.id).toBe(first.body.id);
    expect(files()).toHaveLength(1);
    expect(parseCase(JSON.parse(fs.readFileSync(path.join(pinnedDir(), files()[0]), "utf8"))).expect.contracts).toEqual({ transfer_kept: ASK.saw.contracts.transfer_kept });
  });

  it("accepts what the screen showed when it still matches", async () => {
    await writeKey(KEY);
    const saw = { verdict: ASK.saw.verdict, contracts: { transfer_kept: ASK.saw.contracts.transfer_kept }, experience: {} };
    expect((await POST(send("POST", "", { ...ASK, saw }))).status).toBe(200);
  });

  it("pins a passed call too", async () => {
    await writeKey(KEY);
    record = agentRecordOf(passedSample, "call_c41d07");
    const res = await POST(send("POST", "", { callId: "call_c41d07", keep: { contracts: [], experience: [] }, saw: sawOf(record) }));
    expect(res.status).toBe(200);
    expect(parseCase(JSON.parse(fs.readFileSync(path.join(pinnedDir(), files()[0]), "utf8"))).expect.verdict).toBe(sawOf(record).verdict);
  });
});

describe("refusals write nothing", () => {
  const refused = async (code: string, httpStatus = 409, ask: unknown = ASK) => {
    const r = await read(await POST(send("POST", "", ask)));
    expect(r.status).toBe(httpStatus);
    expect(r.body.error).toBe(code);
    expect(Object.keys(r.body).sort()).toEqual(["error", "message"]);
    expect(files()).toEqual([]);
    return r;
  };

  it("a record for a different call (409)", async () => {
    await writeKey(KEY);
    record = agentRecordOf(failedSample, "call_other");
    await refused("mismatch");
  });

  it("a record that is not an object (409)", async () => {
    await writeKey(KEY);
    record = ["x"];
    await refused("mismatch");
  });

  it("a record with no agent id, or one that is not an id (409), is not given a made-up one", async () => {
    await writeKey(KEY);
    const without = { ...(record as Record<string, unknown>) };
    delete without.agent_id;
    record = without;
    await refused("unreadable");
    for (const agent_id of ["has space", "../x", "", 5, null, "x".repeat(129)]) {
      record = { ...without, agent_id };
      await refused("unreadable");
    }
  });

  it("a call that has not ended (409)", async () => {
    await writeKey(KEY);
    record = { ...(record as object), call_status: "ongoing" };
    await refused("not_ended");
  });

  it("a call with no report: no transcript (409)", async () => {
    await writeKey(KEY);
    record = { call_id: CALL, call_status: "ended", agent_id: "agent_1" };
    await refused("no_report");
  });

  it("a call that reads differently from what the screen showed (409)", async () => {
    await writeKey(KEY);
    const r = await refused("changed", 409, { ...ASK, saw: { ...ASK.saw, verdict: "passed" } });
    expect(r.body.message).toBe("This call reads differently now. Reload it and try again.");
    await refused("changed", 409, { ...ASK, saw: { ...ASK.saw, contracts: { ...ASK.saw.contracts, transfer_kept: "passed" } } });
    // The screen showed nothing for a kept item.
    await refused("changed", 409, { ...ASK, saw: { ...ASK.saw, contracts: {} } });
  });

  it("an experience check that reads differently from what the screen showed (409)", async () => {
    await writeKey(KEY);
    const out = analyzeRetellCall(record, { tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    expect(out.kind).toBe("report");
    if (out.kind !== "report") return;
    const now = out.report.experience.problems.some((p) => p.check === "agent_ends_call") ? "problem" : "clean";
    const saw = { ...ASK.saw, experience: { agent_ends_call: now === "problem" ? "clean" : "problem" } };
    await refused("changed", 409, { callId: CALL, keep: { contracts: [], experience: ["agent_ends_call"] }, saw });
  });

  it("a call that holds the stored key (409), and the key is in no pin file", async () => {
    await writeKey(KEY);
    record = withKeyInTranscript(KEY);
    const r = await refused("key_in_call", 409, { ...ASK, saw: sawOf(record) });
    expect(r.text).not.toContain(KEY);
    expect(r.text).not.toContain("PINROUTE");
    expect(fs.existsSync(pinnedDir()) ? fs.readdirSync(pinnedDir()) : []).toEqual([]);
  });

  it("a key with characters JSON escapes is found in the file text too", async () => {
    const odd = 'key_"quoted"\\slash_9f3b7c1d';
    await writeKey(odd);
    record = withKeyInTranscript(odd);
    await refused("key_in_call", 409, { ...ASK, saw: sawOf(record) });
  });

  it("a note that holds the stored key (409)", async () => {
    await writeKey(KEY);
    await refused("key_in_call", 409, { ...ASK, note: `the key is ${KEY}` });
  });

  it("Retell failing: only a fixed message comes back, never what Retell said", async () => {
    await writeKey(KEY);
    status = 404;
    const missing = await refused("not_found", 404);
    expect(missing.text).not.toContain(MARKER);
    status = 401;
    const bad = await refused("bad_key", 502);
    expect(bad.text).not.toContain(MARKER);
  });
});

describe("listing and deleting", () => {
  it("lists a summary with a fresh check, and never a word of the call", async () => {
    await writeKey(KEY);
    record = marked(agentRecordOf(failedSample, CALL), MARKER);
    const posted = await read(await POST(send("POST", "", { ...ASK, saw: sawOf(record), note: "transfer promised" })));
    expect(posted.status).toBe(200);
    expect(posted.text).not.toContain(MARKER);
    requests = [];

    const listed = await read(await GET(send("GET", "")));
    expect(listed.status).toBe(200);
    expect(listed.text).not.toContain(MARKER);
    expect(listed.text).not.toContain("transcript");
    expect(requests).toEqual([]);
    expect(listed.body.problems).toEqual([]);
    const [one] = listed.body.pins as Record<string, unknown>[];
    expect(one).toMatchObject({
      id: posted.body.id,
      callId: CALL,
      pinnedWith: pkg.version,
      note: "transfer promised",
      status: "held",
      kept: { verdict: expect.any(String), contracts: { transfer_kept: expect.any(String) }, experience: {} },
      changes: [],
    });
    expect(typeof one.pinnedAt).toBe("string");
    expect("agentVersion" in one).toBe(true);
    expect("record" in one).toBe(false);
  });

  it("says changed when the pin's kept verdict no longer matches what the engine reads", async () => {
    const pin = failedPin(CALL);
    pin.expect.verdict = "passed";
    pin.expect.contracts = {};
    fs.mkdirSync(pinnedDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(pinnedDir(), `${pin.id}.json`), JSON.stringify(pin), { mode: 0o600 });
    const listed = await read(await GET(send("GET", "")));
    const [one] = listed.body.pins as { status: string; changes: { what: string; was: string; now: string }[] }[];
    expect(one.status).toBe("changed");
    expect(one.changes[0]).toEqual({ what: "verdict", name: "verdict", was: "passed", now: "failed" });
    expect(requests).toEqual([]);
  });

  it("lists no pins for a fresh folder, and names a bad file without its content", async () => {
    expect((await read(await GET(send("GET", "")))).body).toEqual({ pins: [], problems: [] });
    fs.mkdirSync(pinnedDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(pinnedDir(), "pin-junk.json"), `{"secret": "${MARKER}"`, { mode: 0o600 });
    const listed = await read(await GET(send("GET", "")));
    expect(listed.text).not.toContain(MARKER);
    expect(listed.body.pins).toEqual([]);
    expect((listed.body.problems as { file: string }[]).map((p) => p.file)).toEqual(["pin-junk.json"]);
  });

  it("answers a plain code when the pinned folder is open to others", async () => {
    fs.mkdirSync(pinnedDir(), { recursive: true });
    fs.chmodSync(pinnedDir(), 0o755);
    const r = await read(await GET(send("GET", "")));
    expect(r.status).toBe(500);
    expect(r.body.error).toBe("store_unsafe");
    expect(r.text).not.toContain(home);
  });

  it("deletes one pin by id, and all of them", async () => {
    fs.mkdirSync(pinnedDir(), { recursive: true, mode: 0o700 });
    const a = failedPin("call_a1");
    const b = passedPin("call_b2");
    for (const p of [a, b]) fs.writeFileSync(path.join(pinnedDir(), `${p.id}.json`), JSON.stringify(p), { mode: 0o600 });
    const one = await read(await deleteOne(send("DELETE", `/${a.id}`), ctx(a.id)));
    expect(one.status).toBe(200);
    expect(files()).toEqual([`${b.id}.json`]);
    const again = await read(await deleteOne(send("DELETE", `/${a.id}`), ctx(a.id)));
    expect(again.status).toBe(404);
    expect(again.body.error).toBe("no_such_pin");
    const all = await read(await deleteAll(send("DELETE", "")));
    expect(all.status).toBe(200);
    expect(all.body.deleted).toBe(1);
    expect(files()).toEqual([]);
  });

  it("refuses an id that is not a pin id (400) and touches no file", async () => {
    fs.mkdirSync(pinnedDir(), { recursive: true, mode: 0o700 });
    const outside = path.join(home, "keep.json");
    fs.writeFileSync(outside, "{}");
    for (const id of ["../keep", "..%2Fkeep", "pin-../keep", "PIN-x", "pin-", "x", `pin-${"a".repeat(65)}`, "pin-a/b", "config"]) {
      const res = await deleteOne(send("DELETE", `/${encodeURIComponent(id)}`), ctx(id));
      expect(res.status, id).toBe(400);
      expect((await res.json()).error).toBe("bad_pin_id");
    }
    expect(fs.existsSync(outside)).toBe(true);
  });
});

describe("headers", () => {
  it("every answer is no-store and forbids framing", async () => {
    for (const res of [await GET(send("GET", "")), await POST(send("POST", "", ASK)), await deleteAll(send("DELETE", ""))]) {
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("x-frame-options")).toBe("DENY");
    }
  });
});
