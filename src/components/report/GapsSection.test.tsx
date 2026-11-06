import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { GapsSection } from "./GapsSection";
import { failedSample } from "@/report/samples";
import { unverifiedSample } from "@/report/demo-states";

describe("GapsSection", () => {
  it("names each gap in plain words with the engine's detail and a link to where it is", () => {
    render(<GapsSection report={unverifiedSample} />);
    const section = screen.getByRole("region", { name: "What's missing" });
    expect(within(section).getByText("A tool result gave no success signal")).toBeInTheDocument();
    expect(within(section).getByText(/The booking call returned no success field/)).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "Show in the call" })).toHaveAttribute("href", "#item-33");
  });

  it("lists a gap that cites no items without a link", () => {
    const report = { ...unverifiedSample, evidence: { ...unverifiedSample.evidence, gaps: [{ ...unverifiedSample.evidence.gaps[0], seqs: [] }] } };
    render(<GapsSection report={report} />);
    expect(screen.getByText("A tool result gave no success signal")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("is absent when the evidence has no gaps", () => {
    const { container } = render(<GapsSection report={failedSample} />);
    expect(container).toBeEmptyDOMElement();
  });
});
