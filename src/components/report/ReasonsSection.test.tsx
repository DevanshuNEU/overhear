import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReasonsSection } from "./ReasonsSection";
import { needsReviewSample, passedSample } from "@/report/samples";
import { unverifiedSample } from "@/report/demo-states";

describe("ReasonsSection", () => {
  it("says why the call needs review, with the caller's request and what the system did", () => {
    render(<ReasonsSection report={needsReviewSample} />);
    const section = screen.getByRole("region", { name: "Why it needs review" });
    const reason = within(section).getByRole("article");
    expect(reason).toHaveTextContent("At 0:11 the caller asked to book an appointment.");
    expect(within(reason).getByRole("group", { name: "Asked" })).toHaveTextContent("So I actually wanted to book an appointment");
    const did = within(reason).getByRole("group", { name: "Did" });
    // A tool call and its result are one line.
    expect(within(did).getAllByRole("listitem")).toHaveLength(1);
    expect(did).toHaveTextContent("check_availability failed");
    expect(within(reason).getByRole("link", { name: "Show in the call" })).toHaveAttribute("href", "#item-4");
  });

  it("does not set up a said column when the reason rests on no agent words", () => {
    const { container } = render(<ReasonsSection report={needsReviewSample} />);
    expect(container.querySelector('[class*="md:grid-cols-2"]')).toBeNull();
    expect(screen.queryByRole("group", { name: "Said" })).not.toBeInTheDocument();
  });

  it("leaves the rules that could not be checked to the section that says why, and has no section of its own", () => {
    const { container } = render(<ReasonsSection report={unverifiedSample} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a could-not-check reason whose words say more than the gap does", () => {
    const reasons = unverifiedSample.reasons.map((r, i) => (i === 0 ? { ...r, text: "The booking result had no success field, and the agent spoke before it came back." } : r));
    render(<ReasonsSection report={{ ...unverifiedSample, reasons }} />);
    expect(screen.getByText("The booking result had no success field, and the agent spoke before it came back.")).toBeInTheDocument();
  });

  it("still names a reason that cites nothing, with no link and no lanes", () => {
    const report = { ...needsReviewSample, reasons: [{ ...needsReviewSample.reasons[0], seqs: [] }] };
    render(<ReasonsSection report={report} />);
    const reason = screen.getByRole("article");
    expect(reason).toHaveTextContent("At 0:11 the caller asked to book an appointment.");
    expect(within(reason).queryByRole("link")).not.toBeInTheDocument();
    expect(within(reason).queryByRole("group")).not.toBeInTheDocument();
  });

  it("is absent when the call needs no review", () => {
    const { container } = render(<ReasonsSection report={passedSample} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("goes straight to the evidence for the reason the lead already said", () => {
    render(<ReasonsSection report={needsReviewSample} leadReason={0} />);
    const reason = screen.getByRole("article");
    expect(within(reason).getByText(needsReviewSample.reasons[0].text)).toHaveClass("sr-only");
    expect(within(reason).getByRole("group", { name: "Asked" })).toBeInTheDocument();
  });
});
