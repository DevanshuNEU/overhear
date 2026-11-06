// The loading screen lives inside the page, after the lookup. This holds the wait open by hand to see it, then lets it go.
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { failedSample } from "@/report/samples";

let release: () => void = () => {};
let waited: Promise<void> = Promise.resolve();
vi.mock("@/report/store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/report/store")>()),
  readyDelay: () => {
    waited = new Promise<void>((resolve) => (release = resolve));
    return waited;
  },
}));

describe("/reports/[callId] while a report is made ready", () => {
  it("shows the loading screen in place, then the report", async () => {
    const { default: ReportPage } = await import("./page");
    const element = await ReportPage({ params: Promise.resolve({ callId: failedSample.callId }) });
    await act(async () => {
      render(element);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Loading the call");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    await act(async () => {
      release();
      await waited;
    });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(failedSample.headline);
  });

  it("still answers not found before it shows any loading screen", async () => {
    const { default: ReportPage } = await import("./page");
    await expect(ReportPage({ params: Promise.resolve({ callId: "call_nope" }) })).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
});
