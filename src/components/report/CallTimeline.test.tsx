import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CallTimeline } from "./CallTimeline";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";

describe("CallTimeline", () => {
  it("lists every item of the call in order, under its own heading", () => {
    render(<CallTimeline report={failedSample} />);
    const section = screen.getByRole("region", { name: "The call" });
    const items = within(section).getAllByRole("listitem").filter((li) => li.id.startsWith("item-"));
    expect(items).toHaveLength(failedSample.evidence.items.length);
    expect(items.map((li) => li.id)).toEqual(failedSample.evidence.items.map((it) => `item-${it.seq}`));
  });

  it("names who spoke and when, and keeps the words as spoken", () => {
    render(<CallTimeline report={failedSample} />);
    const turn = document.getElementById("item-27")!;
    expect(within(turn).getByText("Agent")).toBeInTheDocument();
    expect(within(turn).getByText("2:22")).toBeInTheDocument();
    expect(turn).toHaveTextContent("Transferring you to a nurse now");
    expect(within(document.getElementById("item-15")!).getByText("Caller")).toBeInTheDocument();
  });

  it("shows tool calls, results and raw detail as quiet lines, with raw detail closed", () => {
    render(<CallTimeline report={failedSample} />);
    const call = document.getElementById("item-22")!;
    expect(call).toHaveTextContent("Called book_appointment");
    expect((call.querySelector("details[data-raw]") as HTMLDetailsElement).open).toBe(false);
    expect(document.getElementById("item-24")).toHaveTextContent("book_appointment succeeded");
  });

  it("tags an item with each finding that cites it, linking back to the finding", () => {
    render(<CallTimeline report={failedSample} />);
    const turn25 = document.getElementById("item-25")!;
    const links = within(turn25).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([
      "Promises backed by the system",
      "Spoken details match the booking",
      "Transfers kept",
    ]);
    expect(links[2]).toHaveAttribute("href", "#finding-transfer_kept-0");
    // An item no finding cites carries no tag.
    expect(within(document.getElementById("item-1")!).queryAllByRole("link")).toHaveLength(0);
  });

  it("draws a thread for each finding that needs attention, and none for a call that held", () => {
    const { container, rerender } = render(<CallTimeline report={failedSample} />);
    expect(container.querySelectorAll("[data-rail]").length).toBeGreaterThan(0);
    for (const rail of container.querySelectorAll("[data-rail]")) expect(rail.closest("[aria-hidden='true']")).not.toBeNull();
    rerender(<CallTimeline report={passedSample} />);
    expect(container.querySelectorAll("[data-rail]")).toHaveLength(0);
  });

  it("renders a call with no findings as a plain timeline", () => {
    render(<CallTimeline report={needsReviewSample} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(document.getElementById("item-9")).toHaveTextContent("check_availability failed");
  });
});
