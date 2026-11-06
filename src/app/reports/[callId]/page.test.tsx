import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import ReportPage, { generateMetadata } from "./page";
import { failedSample } from "@/report/samples";

afterEach(() => vi.unstubAllEnvs());

const params = (callId: string) => ({ params: Promise.resolve({ callId }) });

describe("/reports/[callId]", () => {
  it("renders the report for a known call", async () => {
    render(await ReportPage(params(failedSample.callId)));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(failedSample.headline);
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

  it("titles the tab with the call id", async () => {
    expect(await generateMetadata(params(failedSample.callId))).toEqual({ title: `${failedSample.callId} - Overhear` });
  });
});
