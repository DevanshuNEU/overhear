import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { sampleRows } from "@/demo-samples";
import { countRows } from "./callListModel";
import { currentHref, visit } from "@/test-utils/fakeNavigation";
import { SampleListScreen } from "./SampleListScreen";
import { RUN_IT_URL, SAMPLE_WORDS } from "./sampleListWords";

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), ...(await import("@/test-utils/fakeNavigation")).navigationMock }));

beforeEach(() => {
  visit("/");
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rows = sampleRows();
const counts = countRows(rows);

describe("the sample list", () => {
  it("leads with how many sample calls failed, then says no AI model decides", () => {
    render(<SampleListScreen rows={rows} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      `${counts.failed} of ${rows.length} sample calls failed. Each one is checked against what the agent told the caller. No AI model decides the verdict.`,
    );
  });

  it("has one row per sample, each linking to its report", () => {
    render(<SampleListScreen rows={rows} />);
    for (const row of rows) expect(document.querySelector(`[data-call-id="${row.callId}"] a`)).toHaveAttribute("href", `/reports/${row.callId}`);
  });

  it("has the hosted shell and no pull controls", () => {
    render(<SampleListScreen rows={rows} />);
    expect(screen.getByText(SAMPLE_WORDS.navNote)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run it on your calls" })).toHaveAttribute("href", RUN_IT_URL);
    expect(screen.queryByRole("link", { name: "Test call" })).toBeNull();
    for (const name of [/Check the last/, /Check again/, /Disconnect/, /Stop checking/]) expect(screen.queryByText(name)).toBeNull();
    expect(screen.getByText(SAMPLE_WORDS.footer)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("links nowhere near the old grader pages", () => {
    render(<SampleListScreen rows={rows} />);
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).not.toMatch(/^\/(demo|how-it-works|eval)/);
  });

  it("keeps the filter in the address and carries it to the reports", () => {
    visit("/?show=failed");
    render(<SampleListScreen rows={rows} />);
    const items = within(screen.getByRole("list", { name: "Failed" })).getAllByRole("listitem");
    expect(items).toHaveLength(counts.failed);
    expect(items[0].querySelector("a")).toHaveAttribute("href", expect.stringMatching(/\?from=failed$/));
  });

  it("changes the filter in place", () => {
    render(<SampleListScreen rows={rows} />);
    fireEvent.click(screen.getByRole("link", { name: /^Passed/ }));
    expect(currentHref()).toBe("/?show=passed");
  });
});
