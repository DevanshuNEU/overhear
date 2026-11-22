// @vitest-environment node
// policy.json in the Overhear folder: used by the local analyzers when valid, ignored (with one fixed sentence) when
// not, and never read by a hosted copy.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import preset from "@/engine/presets/northwind-clinic.json";
import { toRetell } from "@/engine/testing/retell";
import { ingestFiles } from "@/files/ingest";
import { clearFiles, getFileReport, listFiles } from "@/files/store";
import { analyzeCall } from "@/pull/analyzer";
import { failedSample } from "@/report/samples";
import { IGNORED_POLICY_SENTENCE, loadLocalPolicy, parsePolicyText } from "./policy-file";

let home: string;
const mine = () => ({ ...JSON.parse(JSON.stringify(preset)), timezone: "Asia/Kolkata" }) as Record<string, unknown>;
const env = (over: Record<string, string | undefined> = {}) => ({ OVERHEAR_LOCAL: "1", OVERHEAR_HOME: home, ...over });
const put = (body: unknown) => fs.writeFileSync(path.join(home, "policy.json"), typeof body === "string" ? body : JSON.stringify(body));

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "overhear-policy-")));
  fs.chmodSync(home, 0o700);
  vi.stubEnv("OVERHEAR_LOCAL", "1");
  vi.stubEnv("OVERHEAR_HOME", home);
  clearFiles();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(home, { recursive: true, force: true });
  clearFiles();
});

describe("loadLocalPolicy", () => {
  it("returns the policy when the file is valid", () => {
    put(mine());
    expect(loadLocalPolicy(env())?.timezone).toBe("Asia/Kolkata");
  });

  it("returns nothing and logs nothing when there is no file", () => {
    const log = vi.fn();
    expect(loadLocalPolicy(env(), log)).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });

  it("ignores an invalid file and logs one fixed sentence, never the contents, once", () => {
    const log = vi.fn();
    put('{"secret-looking": "sk-live-123"');
    expect(loadLocalPolicy(env(), log)).toBeUndefined();
    expect(loadLocalPolicy(env(), log)).toBeUndefined();
    put({ packs: ["scheduling"], tools: { x: { role: "nonsense" } }, note: "sk-live-123" });
    expect(loadLocalPolicy(env(), log)).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(IGNORED_POLICY_SENTENCE);
    expect(IGNORED_POLICY_SENTENCE).not.toContain("sk-live");
  });

  it("never reads it on a hosted copy", () => {
    put(mine());
    expect(loadLocalPolicy(env({ OVERHEAR_LOCAL: undefined }))).toBeUndefined();
  });

  it("refuses a symlink, a file others can write, and a folder others can write", () => {
    const real = path.join(home, "real.json");
    fs.writeFileSync(real, JSON.stringify(mine()));
    fs.symlinkSync(real, path.join(home, "policy.json"));
    const log = vi.fn();
    expect(loadLocalPolicy(env(), log)).toBeUndefined();
    fs.rmSync(path.join(home, "policy.json"));
    put(mine());
    fs.chmodSync(path.join(home, "policy.json"), 0o666);
    expect(loadLocalPolicy(env(), log)).toBeUndefined();
    fs.chmodSync(path.join(home, "policy.json"), 0o644);
    expect(loadLocalPolicy(env(), log)).toBeDefined();
    fs.chmodSync(home, 0o777);
    expect(loadLocalPolicy(env(), log)).toBeUndefined();
  });
});

describe("parsePolicyText", () => {
  it("lists each schema problem with its path", () => {
    const r = parsePolicyText(JSON.stringify({ packs: ["scheduling"], tools: { x: { role: "nonsense" } } }));
    expect("problems" in r && r.problems.join("\n")).toMatch(/tools\.x\.role/);
  });
});

describe("the local analyzers", () => {
  const record = () => toRetell(failedSample.evidence);
  const zoneOf = (o: ReturnType<typeof analyzeCall>) => (o.kind === "report" ? o.report.timezone : o.kind);

  it("the pull analyzer uses a valid file for every call, and the preset without it", () => {
    expect(zoneOf(analyzeCall(record()))).toBe("UTC");
    put({ ...mine(), timezone: "America/Chicago" });
    expect(zoneOf(analyzeCall(record()))).toBe("America/Chicago");
  });

  it("the pull analyzer ignores an invalid file", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    put("{nope");
    const out = analyzeCall(record());
    expect(out.kind === "report" && out.report.policy).toEqual({ ...preset, packs: ["healthcare"] });
  });

  it("the files analyzer uses a valid file, and ignores an invalid one", () => {
    const lk = JSON.parse(fs.readFileSync(path.join(process.cwd(), "eval/engine/cases/livekit-booked-no-tool.json"), "utf8")) as { record: unknown };
    const text = JSON.stringify(lk.record);
    put(mine());
    expect(ingestFiles([{ name: "a.json", text }])).toEqual([]);
    const id = listFiles().rows[0].callId;
    expect(getFileReport(id)?.policy.timezone).toBe("Asia/Kolkata");
    clearFiles();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    put("{nope");
    expect(ingestFiles([{ name: "a.json", text }])).toEqual([]);
    expect(getFileReport(listFiles().rows[0].callId)?.policy.timezone).not.toBe("Asia/Kolkata");
  });

  it("a hosted copy never uses the file", () => {
    put({ ...mine(), timezone: "America/Chicago" });
    vi.stubEnv("OVERHEAR_LOCAL", "");
    expect(zoneOf(analyzeCall(record()))).toBe("UTC");
  });
});
