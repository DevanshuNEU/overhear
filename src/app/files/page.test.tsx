import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";
import { analyzeRecord } from "@/engine/analyze";
import { addProblem, addReport, clearFiles } from "@/files/store";
import { visit } from "@/test-utils/fakeNavigation";
import ReportsLayout from "../reports/layout";
import FilesPage, { dynamic } from "./page";

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), ...(await import("@/test-utils/fakeNavigation")).navigationMock }));
const { yourDemoCallIds } = vi.hoisted(() => ({ yourDemoCallIds: vi.fn(async (): Promise<string[]> => []) }));
vi.mock("@/demo-call/report-source", () => ({ yourDemoCallIds }));
const hasKey = vi.fn<() => Promise<boolean>>();
vi.mock("@/pull/key-store", async (importOriginal) => ({ ...(await importOriginal<object>()), hasKey: () => hasKey() }));

const record = JSON.parse(fs.readFileSync(path.join(process.cwd(), "eval/engine/cases/livekit-booked-no-tool.json"), "utf8")).record as unknown;
function addCall() {
  const outcome = analyzeRecord(record, { tz: "UTC" });
  if (outcome.kind !== "report") throw new Error("fixture must give a report");
  addReport("booked.json", outcome.report);
}

/** The path `redirect()` was asked to go to, read from the error Next throws for it. */
async function redirectTarget(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
  } catch (err) {
    const digest = (err as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return digest.split(";")[2] ?? null;
    throw err;
  }
  return null;
}

beforeEach(() => {
  clearFiles();
  hasKey.mockResolvedValue(false);
  visit("/files");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
});
afterEach(() => {
  cleanup();
  clearFiles();
  hasKey.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/files", () => {
  it("is rendered per request", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("is a 404 on a hosted copy", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "");
    addCall();
    await expect(FilesPage()).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404") });
  });

  it("goes back to / with nothing open", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    expect(await redirectTarget(FilesPage)).toBe("/");
  });

  it("lists the calls read from files, with no Retell key", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    addCall();
    render(await FilesPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("1 of 1 call failed. Read from 1 session report file on this computer.");
    expect(document.querySelector('[data-call-id="AJ_offline_booked_no_tool"] a')).toHaveAttribute("href", "/reports/AJ_offline_booked_no_tool?src=files");
    expect(within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["Calls"]);
  });

  it("shows the page when only problems are held, so the person sees why", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    addProblem("notes.json", "not_json");
    render(await FilesPage());
    expect(screen.getByText("notes.json: Not JSON.")).toBeInTheDocument();
  });

  it("adds a Files item to the shell when a key is saved too", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    hasKey.mockResolvedValue(true);
    addCall();
    render(await FilesPage());
    expect(within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link").map((a) => a.textContent)).toEqual(["Calls", "Files", "Test call"]);
  });
});

describe("the shell on a report opened from files", () => {
  const shell = async () => render(await ReportsLayout({ children: <p>the call</p> }));

  it("links Calls to /files when there is no key and files are open, with no Test call", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    addCall();
    visit("/reports/AJ_offline_booked_no_tool?src=files", { callId: "AJ_offline_booked_no_tool" });
    await shell();
    const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Calls", "/files"]]);
    expect(screen.queryByText("Connected to Retell.")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to all calls" })).toHaveAttribute("href", "/files");
  });

  it("gives a third item Files when both exist", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    hasKey.mockResolvedValue(true);
    addCall();
    visit("/reports/x", { callId: "x" });
    await shell();
    const links = within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Calls", "/"], ["Files", "/files"], ["Test call", "/test-call"]]);
  });

  it("reads no key when no file is open", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    visit("/reports/x", { callId: "x" });
    await shell();
    expect(hasKey).not.toHaveBeenCalled();
    expect(screen.getByText("Connected to Retell.")).toBeInTheDocument();
  });
});
