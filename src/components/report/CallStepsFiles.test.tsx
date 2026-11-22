import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PullRow } from "@/pull/pull";
import { router, visit } from "@/test-utils/fakeNavigation";
import { STEP_LABEL } from "@/report/labels";
import { CallSteps } from "./CallSteps";

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), ...(await import("@/test-utils/fakeNavigation")).navigationMock }));

const report = (callId: string, verdict: "failed" | "passed"): PullRow => ({ callId, startedAt: 1, durationMs: 1, state: "report", verdict, headline: "h" });
const FILE_ROWS: PullRow[] = [report("AJ_a", "failed"), report("AJ_b~copy", "failed"), report("AJ_c", "passed")];

let fetchMock: ReturnType<typeof vi.fn>;
function serve(body: unknown = { rows: FILE_ROWS, problems: [] }) {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
}

function open(callId: string, from?: string) {
  visit(`/reports/${callId}?src=files${from ? `&from=${from}` : ""}`, { callId });
  return render(<CallSteps />);
}

beforeEach(() => {
  window.sessionStorage.clear();
  serve();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const link = (name: string) => screen.getByRole("link", { name });

describe("a report opened from the list of files (src=files)", () => {
  it("reads /api/files, not a pull, and steps in the order the files list gives", async () => {
    window.sessionStorage.setItem("overhear.pull", "pull_1");
    open("AJ_b~copy");
    expect(await screen.findByRole("link", { name: STEP_LABEL.previous })).toHaveAttribute("href", "/reports/AJ_a?src=files");
    expect(link(STEP_LABEL.next)).toHaveAttribute("href", "/reports/AJ_c?src=files");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/files", { cache: "no-store" });
  });

  it("steps with no pull remembered, as with no Retell key", async () => {
    open("AJ_a");
    expect(await screen.findByRole("link", { name: STEP_LABEL.next })).toHaveAttribute("href", "/reports/AJ_b~copy?src=files");
  });

  it("goes back to /files with the filter, and keeps both in the step links", async () => {
    open("AJ_a", "failed");
    expect(link("Back to failed calls")).toHaveAttribute("href", "/files?show=failed");
    expect(await screen.findByRole("link", { name: STEP_LABEL.next })).toHaveAttribute("href", "/reports/AJ_b~copy?src=files&from=failed");
    expect(link(STEP_LABEL.previous)).toHaveAttribute("aria-disabled", "true");
  });

  it("goes back to /files with no filter under All", async () => {
    open("AJ_a");
    expect(link("Back to all calls")).toHaveAttribute("href", "/files");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("steps with J and K along the files", async () => {
    open("AJ_a");
    await screen.findByRole("link", { name: STEP_LABEL.next });
    fireEvent.keyDown(window, { key: "j" });
    expect(router.push).toHaveBeenCalledWith("/reports/AJ_b~copy?src=files");
  });

  it("leaves only the way back when the files cannot be read", async () => {
    serve({});
    open("AJ_a");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: STEP_LABEL.next })).toBeNull();
    expect(link("Back to all calls")).toHaveAttribute("href", "/files");
  });
});
