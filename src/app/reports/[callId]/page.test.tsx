import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import ReportPage, { generateMetadata } from "./page";
import { failedSample } from "@/report/samples";
import { KEEP_WORDS } from "@/report/labels";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const params = (callId: string) => ({ params: Promise.resolve({ callId }) });

describe("/reports/[callId]", () => {
  it("renders the report for a known call", async () => {
    render(await ReportPage(params(failedSample.callId)));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The agent said twice that it was transferring the caller");
  });

  it("has no route-level loading screen, because that streams a 200 before the lookup can say 404", () => {
    expect(fs.existsSync(path.resolve(__dirname, "../loading.tsx"))).toBe(false);
    expect(fs.existsSync(path.resolve(__dirname, "loading.tsx"))).toBe(false);
  });

  it("falls through to the not found page for an unknown call", async () => {
    await expect(ReportPage(params("call_nope"))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("never renders a report that fails the schema, and says it cannot be read", async () => {
    vi.stubEnv("OVERHEAR_DEMO_STATES", "1");
    render(await ReportPage(params("call_demo_unreadable")));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This report can't be read.");
    expect(screen.queryByText(/Failed|Passed|Violated/)).not.toBeInTheDocument();
    // None of the bad report's own words reach the screen: not its headline, its call text or its tool names.
    expect(document.body).not.toHaveTextContent(failedSample.headline);
    expect(document.body).not.toHaveTextContent("Transferring you to a nurse now");
  });

  it("titles the tab with the stored headline and the call id, since the page itself leads with a specific sentence", async () => {
    expect(await generateMetadata(params(failedSample.callId))).toEqual({ title: `${failedSample.headline} - ${failedSample.callId} - Overhear` });
  });

  it("never repeats an address that does not look like an id in the tab's title, and falls back to a plain title", async () => {
    const message = "Your account is locked. Call 555-0100";
    const { title } = await generateMetadata(params(message));
    expect(title).toBe("Call report - Overhear");
    expect(title).not.toContain("locked");
  });

  it("titles the tab with the call id alone when there is no report to read", async () => {
    expect(await generateMetadata(params("call_nope"))).toEqual({ title: "call_nope - Overhear" });
  });

  describe("Keep as a test", () => {
    const keepButton = () => screen.queryByRole("button", { name: KEEP_WORDS.open });

    it("is not on a hosted copy, for a sample or a demo state", async () => {
      vi.stubEnv("OVERHEAR_DEMO_STATES", "1");
      render(await ReportPage(params("call_demo_unverified")));
      expect(keepButton()).toBeNull();
    });

    it("is not on a built-in sample, even in local mode", async () => {
      vi.stubEnv("OVERHEAR_LOCAL", "1");
      render(await ReportPage(params(failedSample.callId)));
      expect(keepButton()).toBeNull();
    });

    it("is on a call from this computer in local mode", async () => {
      vi.stubEnv("OVERHEAR_LOCAL", "1");
      vi.stubEnv("OVERHEAR_DEMO_STATES", "1");
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ pins: [], problems: [] }))));
      render(await ReportPage(params("call_demo_unverified")));
      expect(keepButton()).toBeInTheDocument();
    });
  });
});
