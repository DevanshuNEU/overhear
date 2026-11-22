// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FILES_MESSAGE, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, PROBLEM_REASON } from "@/files/labels";
import { clearFiles, fileCount } from "@/files/store";
import { getReport } from "@/report/store";
import { DELETE, GET, POST } from "./route";

const HOST = "localhost:3000";
const ORIGIN = `http://${HOST}`;

const recordOf = (name: string): unknown => (JSON.parse(fs.readFileSync(path.join(process.cwd(), "eval/engine/cases", `${name}.json`), "utf8")) as { record: unknown }).record;
const file = (name: string, record: unknown) => ({ name, text: JSON.stringify(record) });

beforeEach(() => {
  vi.stubEnv("OVERHEAR_LOCAL", "1");
  vi.stubEnv("__NEXT_PRIVATE_ORIGIN", "http://127.0.0.1:3000");
  clearFiles();
});
afterEach(() => {
  vi.unstubAllEnvs();
  clearFiles();
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000/api/files`, { method: "POST", headers: { host: HOST, origin: ORIGIN, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const send = (method: "GET" | "DELETE", headers: Record<string, string> = {}) =>
  new Request(`http://localhost:3000/api/files`, { method, headers: { host: HOST, ...(method === "DELETE" ? { origin: ORIGIN } : {}), ...headers } });

describe("the files route", () => {
  it("answers 404 on every method when OVERHEAR_LOCAL is unset", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "");
    expect((await POST(post({ files: [] }))).status).toBe(404);
    expect((await GET(send("GET"))).status).toBe(404);
    expect((await DELETE(send("DELETE"))).status).toBe(404);
  });

  it("refuses a foreign host, and a change without a same-origin Origin", async () => {
    const one = { files: [file("a.json", recordOf("livekit-booked-no-tool"))] };
    expect((await POST(post(one, { host: "evil.com" }))).status).toBe(403);
    expect((await POST(post(one, { origin: "http://evil.com" }))).status).toBe(403);
    expect((await DELETE(send("DELETE", { origin: "http://evil.com" }))).status).toBe(403);
    expect((await GET(send("GET", { host: "evil.com" }))).status).toBe(403);
    expect(fileCount()).toBe(0);
  });

  it("reads a LiveKit file into a failed row, keyed by its call id, and opens its report", async () => {
    const res = await POST(post({ files: [file("booked.json", recordOf("livekit-booked-no-tool"))] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { rows: { callId: string; state: string; verdict: string; platform: string; lead?: string }[]; problems: unknown[] };
    expect(body.problems).toEqual([]);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ callId: "AJ_offline_booked_no_tool", state: "report", verdict: "failed", platform: "livekit" });
    expect(body.rows[0].lead).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain("booked.json\"text");
    const found = await getReport("AJ_offline_booked_no_tool");
    expect(found.status).toBe("found");
  });

  it("reads a Retell file through the same engine entry", async () => {
    const res = await POST(post({ files: [file("retell.json", recordOf("mut-booking-never-confirmed"))] }));
    const body = (await res.json()) as { rows: { platform: string; verdict: string }[]; problems: unknown[] };
    expect(body.problems).toEqual([]);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ platform: "retell", verdict: "needs_review" });
  });

  it("mixes platforms in one answer, in the order of the call times", async () => {
    await POST(post({ files: [file("a.json", recordOf("livekit-booked-no-tool")), file("b.json", recordOf("mut-booking-never-confirmed")), file("c.json", recordOf("livekit-booking-success"))] }));
    const body = (await (await GET(send("GET"))).json()) as { rows: { startedAt: number; platform: string }[] };
    expect(body.rows).toHaveLength(3);
    expect(new Set(body.rows.map((r) => r.platform))).toEqual(new Set(["livekit", "retell"]));
    const times = body.rows.map((r) => r.startedAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("sets aside a file that is not JSON, one that is not a session report, and one that cannot be checked, by name only", async () => {
    const res = await POST(
      post({
        files: [
          { name: "notes.json", text: "this is SECRETTEXT not json" },
          file("list.json", ["SECRETTEXT"]),
          file("other.json", { hello: "SECRETTEXT" }),
          file("fine.json", recordOf("livekit-booking-success")),
        ],
      }),
    );
    const body = (await res.json()) as { rows: unknown[]; problems: { file: string; reason: string }[] };
    expect(body.rows).toHaveLength(1);
    expect(body.problems).toEqual([
      { file: "notes.json", reason: "not_json" },
      { file: "list.json", reason: "not_a_report" },
      { file: "other.json", reason: "not_a_report" },
    ]);
    expect(JSON.stringify(body)).not.toContain("SECRETTEXT");
    const again = (await (await GET(send("GET"))).json()) as { problems: unknown[] };
    expect(again.problems).toHaveLength(3);
    expect(Object.values(PROBLEM_REASON).join(" ")).not.toMatch(/[–—]/);
  });

  it("sets aside a session report with no transcript, and one the engine cannot read, as problems", async () => {
    const empty = { job_id: "AJ_empty", room_id: "RM_empty", sdk_version: "1.8.13", chat_history: { items: [] }, events: [] };
    const res = await POST(post({ files: [file("empty.json", empty)] }));
    const body = (await res.json()) as { rows: unknown[]; problems: { file: string; reason: string }[] };
    expect(body.rows).toEqual([]);
    expect(body.problems).toEqual([{ file: "empty.json", reason: "no_transcript" }]);
  });

  it("lists a file over 5 MB as too large without reading it", async () => {
    const big = { name: "big.json", text: " ".repeat(MAX_FILE_BYTES + 1) };
    const res = await POST(post({ files: [big, file("fine.json", recordOf("livekit-booking-success"))] }));
    const body = (await res.json()) as { rows: unknown[]; problems: { file: string; reason: string }[] };
    expect(body.rows).toHaveLength(1);
    expect(body.problems).toEqual([{ file: "big.json", reason: "too_large" }]);
  });

  it("refuses more than 200 files, and more than 50 MB in all, with a fixed sentence", async () => {
    const many = await POST(post({ files: Array.from({ length: MAX_FILES + 1 }, (_, i) => ({ name: `f${i}.json`, text: "{}" })) }));
    expect(many.status).toBe(413);
    expect(await many.json()).toEqual({ error: "too_many_files", message: FILES_MESSAGE.too_many_files });
    const chunk = " ".repeat(MAX_FILE_BYTES);
    const heavy = await POST(post({ files: Array.from({ length: Math.ceil(MAX_TOTAL_BYTES / MAX_FILE_BYTES) + 1 }, (_, i) => ({ name: `f${i}.json`, text: chunk })) }));
    expect(heavy.status).toBe(413);
    expect(await heavy.json()).toEqual({ error: "too_large_total", message: FILES_MESSAGE.too_large_total });
    expect(fileCount()).toBe(0);
  });

  it("refuses a body that is not the shape it expects, never repeating it", async () => {
    for (const body of ["not json SECRETTEXT", { files: "SECRETTEXT" }, { files: [] }, { files: [{ name: 1, text: "{}" }] }, { files: [{ name: "a.json" }] }, [1, 2]]) {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: "bad_request", message: FILES_MESSAGE.bad_request });
    }
  });

  it("keeps two files with the same call id and says which file each came from", async () => {
    const record = recordOf("livekit-booked-no-tool");
    await POST(post({ files: [file("first.json", record), file("copy of first.json", record)] }));
    const body = (await (await GET(send("GET"))).json()) as { rows: { callId: string; file?: string }[] };
    expect(body.rows).toHaveLength(2);
    expect(body.rows.map((r) => r.callId).sort()).toEqual(["AJ_offline_booked_no_tool", "AJ_offline_booked_no_tool~copyoffi"]);
    expect(body.rows.map((r) => r.file).sort()).toEqual(["copy of first.json", "first.json"]);
    expect((await getReport("AJ_offline_booked_no_tool~copyoffi")).status).toBe("found");
  });

  it("empties the store on DELETE, and the report no longer opens", async () => {
    await POST(post({ files: [file("a.json", recordOf("livekit-booked-no-tool")), { name: "bad.json", text: "x" }] }));
    expect(fileCount()).toBe(1);
    const res = await DELETE(send("DELETE"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cleared: true });
    const body = (await (await GET(send("GET"))).json()) as { rows: unknown[]; problems: unknown[] };
    expect(body).toEqual({ rows: [], problems: [] });
    expect((await getReport("AJ_offline_booked_no_tool")).status).toBe("not_found");
  });

  it("forbids framing on every answer", async () => {
    const res = await GET(send("GET"));
    expect(res.headers.get("x-frame-options")).toBe("DENY");
  });
});
