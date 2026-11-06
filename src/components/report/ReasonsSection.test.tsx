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
    expect(did).toHaveTextContent("Called check_availability");
    expect(did).toHaveTextContent("check_availability failed");
    expect(within(reason).getByRole("link", { name: "Show in the call" })).toHaveAttribute("href", "#item-4");
  });

  it("does not set up a said column when the reason rests on no agent words", () => {
    const { container } = render(<ReasonsSection report={needsReviewSample} />);
    expect(container.querySelector('[class*="md:grid-cols-2"]')).toBeNull();
    expect(screen.queryByRole("group", { name: "Said" })).not.toBeInTheDocument();
  });

  it("says once which rules could not be checked, and links to each, instead of repeating each reason", () => {
    render(<ReasonsSection report={unverifiedSample} />);
    const section = screen.getByRole("region", { name: "Why it needs review" });
    expect(within(section).queryAllByRole("article")).toHaveLength(0);
    const links = within(section).getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Promises backed by the system", "#contract-promise_backed"],
      ["Identity checked before changes", "#contract-verified_before_change"],
      ["Spoken details match the booking", "#contract-spoken_matches_committed"],
    ]);
    expect(within(section).getByText("Couldn't check:")).toBeInTheDocument();
  });

  it("still names a reason that cites nothing, with no link and no lanes", () => {
    const report = { ...needsReviewSample, reasons: [{ ...needsReviewSample.reasons[0], seqs: [] }] };
    render(<ReasonsSection report={report} />);
    const reason = screen.getByRole("article");
    expect(reason).toHaveTextContent("At 0:11 the caller asked to book an appointment.");
    expect(within(reason).queryByRole("link")).not.toBeInTheDocument();
    expect(within(reason).queryByRole("group")).not.toBeInTheDocument();
  });

  it("names a rule once even when two reasons point at it", () => {
    const one = unverifiedSample.reasons[0];
    const report = { ...unverifiedSample, reasons: [one, one] };
    render(<ReasonsSection report={report} />);
    expect(screen.getAllByRole("link", { name: "Promises backed by the system" })).toHaveLength(1);
  });

  it("is absent when the call needs no review", () => {
    const { container } = render(<ReasonsSection report={passedSample} />);
    expect(container).toBeEmptyDOMElement();
  });
});
