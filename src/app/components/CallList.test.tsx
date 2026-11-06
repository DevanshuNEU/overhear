import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CallSummary } from "@/qa/queries";
import { CallList } from "./CallList";

const scored: CallSummary = {
  id: "call_scored_1",
  status: "scored",
  composite: 0.9,
  failureCategories: [],
  retellSentiment: "Positive",
  scoredAt: "2026-11-05T10:00:00.000Z",
  startedAt: "2026-11-05T09:58:00.000Z",
};

const processing: CallSummary = {
  ...scored,
  id: "call_processing_2",
  status: "processing",
  composite: null,
  scoredAt: null,
};

describe("CallList", () => {
  it("links each row to its demo call page under /demo/calls/{id}", () => {
    render(<CallList calls={[scored, processing]} />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/demo/calls/call_scored_1", "/demo/calls/call_processing_2"]);
  });

  it("says so when there are no calls", () => {
    render(<CallList calls={[]} />);
    expect(screen.getByText("No calls yet.")).toBeInTheDocument();
  });
});
