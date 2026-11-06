import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { vi } from "vitest";
import { NextSteps } from "./NextSteps";
import { CallReportView } from "./CallReportView";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { unverifiedSample } from "@/report/demo-states";
import { NEXT_STEPS, REASON_NEXT_STEPS } from "@/report/labels";

describe("NextSteps", () => {
  it("lists the numbered steps for what broke, each with its lead and its sentence", () => {
    render(<NextSteps report={failedSample} />);
    const aside = screen.getByRole("complementary", { name: "What to do next" });
    const items = within(aside).getAllByRole("listitem");
    expect(items).toHaveLength(NEXT_STEPS.transfer_kept.length);
    NEXT_STEPS.transfer_kept.forEach((step, i) => {
      expect(items[i]).toHaveTextContent(step.lead);
      expect(items[i]).toHaveTextContent(step.text);
      expect(within(items[i]).getByText(String(i + 1))).toBeInTheDocument();
    });
  });

  it("offers the actions that are true today: copy the call id, and nothing it cannot do", () => {
    render(<NextSteps report={failedSample} />);
    expect(screen.getByRole("button", { name: "Copy call ID for your logs" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Retell/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/regression/i)).not.toBeInTheDocument();
  });

  it("copies the call ID and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<NextSteps report={failedSample} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy call ID for your logs" }));
    expect(writeText).toHaveBeenCalledWith(failedSample.callId);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("shows the step for a review reason, as a check that does not assume the cause", () => {
    render(<NextSteps report={needsReviewSample} />);
    const items = within(screen.getByRole("complementary", { name: "What to do next" })).getAllByRole("listitem");
    expect(items).toHaveLength(REASON_NEXT_STEPS.unanswered_request!.length);
    expect(items[0]).toHaveTextContent("Check what happened after the request.");
    expect(items[0]).toHaveTextContent("If a tool returned an error");
  });

  it("is a list a screen reader reads as one, even where the browser drops list styling", () => {
    render(<NextSteps report={failedSample} />);
    expect(within(screen.getByRole("complementary")).getByRole("list")).toHaveAttribute("role", "list");
  });

  it("is absent when there is nothing to do", () => {
    for (const report of [passedSample, unverifiedSample]) {
      const { container, unmount } = render(<NextSteps report={report} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe("CallReportView with next steps", () => {
  it("puts the steps right after the answer, before the rules, so a narrow window reads answer then steps", () => {
    render(<CallReportView report={failedSample} />);
    const aside = screen.getByRole("complementary", { name: "What to do next" });
    const header = screen.getByRole("heading", { level: 1 });
    const rows = screen.getByRole("region", { name: "Said and did" });
    expect(header.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(aside.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("goes to the right column at 1280 and wider, and under the answer below that", () => {
    const { container } = render(<CallReportView report={failedSample} />);
    const aside = screen.getByRole("complementary");
    expect(aside.className).toContain("xl:order-2");
    expect(container.innerHTML).toContain("xl:grid-cols-");
    // Narrow windows keep the page's reading width; the column only widens it at xl.
    expect(container.innerHTML).toContain("max-w-[1040px] xl:max-w-none");
    // The sticky column never grows taller than the window, so its last step and button stay reachable.
    expect(aside.className).toContain("xl:max-h-[calc(100vh-3rem)]");
    expect(aside.className).toContain("xl:overflow-y-auto");
  });

  it("keeps the main column the same width with or without steps, so the layout does not jump between calls", () => {
    const wrapper = (report: typeof failedSample) => {
      const { container, unmount } = render(<CallReportView report={report} />);
      const el = container.querySelector("[class*='xl:grid-cols-']")!;
      const cls = el.className;
      const hasColumn = screen.queryByRole("complementary") !== null;
      unmount();
      return { cls, hasColumn };
    };
    const withSteps = wrapper(failedSample);
    const without = wrapper(passedSample);
    expect(withSteps.hasColumn).toBe(true);
    expect(without.hasColumn).toBe(false);
    // The same grid either way: with no steps the right column is simply empty.
    expect(without.cls).toBe(withSteps.cls);
  });
});
