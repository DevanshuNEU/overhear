import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportPage, { generateMetadata } from "./page";
import { failedSample } from "@/report/samples";

const params = (callId: string) => ({ params: Promise.resolve({ callId }) });

describe("/reports/[callId]", () => {
  it("renders the report for a known call", async () => {
    render(await ReportPage(params(failedSample.callId)));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(failedSample.headline);
  });

  it("falls through to the not found page for an unknown call", async () => {
    await expect(ReportPage(params("call_nope"))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("titles the tab with the call id", async () => {
    expect(await generateMetadata(params(failedSample.callId))).toEqual({ title: `${failedSample.callId} - Overhear` });
  });
});
