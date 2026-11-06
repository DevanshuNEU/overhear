import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { GapsSection } from "./GapsSection";
import { failedSample } from "@/report/samples";
import { unverifiedSample } from "@/report/demo-states";

describe("GapsSection", () => {
  it("says each gap once: what it is, the engine's detail, the rules it stopped and where it is in the call", () => {
    render(<GapsSection report={unverifiedSample} />);
    const section = screen.getByRole("region", { name: "What we couldn't check" });
    expect(section).toHaveAttribute("id", "gaps");
    expect(within(section).getByText("A tool result gave no success signal")).toBeInTheDocument();
    expect(within(section).getByText(/The booking call returned no success field/)).toBeInTheDocument();
    expect(within(section).getByText("Rules it blocks: Promises backed by the system, Identity checked before changes, Spoken details match the booking.")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "Show in the call" })).toHaveAttribute("href", "#item-33");
  });

  it("names the rules as plain text, not as a list of links", () => {
    render(<GapsSection report={unverifiedSample} />);
    const stopped = screen.getByText(/^Rules it blocks:/);
    expect(within(stopped).queryAllByRole("link")).toHaveLength(0);
  });

  it("lists a gap that stopped no rule without a Rules it blocks line, and one that cites no items without a link", () => {
    const gap = { ...unverifiedSample.evidence.gaps[0], code: "evidence_conflict" as const, seqs: [] };
    const report = { ...unverifiedSample, evidence: { ...unverifiedSample.evidence, gaps: [gap] } };
    render(<GapsSection report={report} />);
    expect(screen.getByText("The records disagree")).toBeInTheDocument();
    expect(screen.queryByText(/^Rules it blocks:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("names a rule a gap stopped when the gap touches what the rule cites, even if the finding did not name the gap", () => {
    const results = unverifiedSample.results.map((c) => ({ ...c, findings: c.findings.map((f) => ({ ...f, gaps: [] })) }));
    render(<GapsSection report={{ ...unverifiedSample, results }} />);
    expect(screen.getByText(/^Rules it blocks: Promises backed by the system/)).toBeInTheDocument();
  });

  it("is absent when the evidence has no gaps", () => {
    const { container } = render(<GapsSection report={failedSample} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("leaves out the gap's sentence when the lead above has already said it", () => {
    const detail = unverifiedSample.evidence.gaps[0].detail;
    render(<GapsSection report={unverifiedSample} saidInLead={detail} />);
    expect(screen.queryByText(detail)).not.toBeInTheDocument();
    expect(screen.getByText("A tool result gave no success signal")).toBeInTheDocument();
    expect(screen.getByText(/^Rules it blocks:/)).toBeInTheDocument();
  });
});
