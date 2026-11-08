import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ExperienceSection } from "./ExperienceSection";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";

describe("ExperienceSection", () => {
  it("counts the problems and shows each one's sentence with a link to its first turn", () => {
    render(<ExperienceSection report={passedSample} />);
    const section = screen.getByRole("region", { name: "Call experience: 1 problem" });
    const [problem] = passedSample.experience.problems;
    expect(within(section).getByText(problem.text)).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "Show in the call" })).toHaveAttribute("href", `#item-${Math.min(...problem.seqs)}`);
  });

  it("ties each link to its own sentence for a screen reader", () => {
    render(<ExperienceSection report={needsReviewSample} />);
    const link = screen.getByRole("link", { name: "Show in the call" });
    expect(link).toHaveAccessibleDescription(needsReviewSample.experience.problems[0].text);
  });

  it("says the call had no problems, and names the checks that ran", () => {
    render(<ExperienceSection report={failedSample} />);
    const section = screen.getByRole("region", { name: "Call experience: no problems found" });
    expect(section).toHaveTextContent("Checked: how the call ends and how errors are handled.");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("names only the checks that ran when it counts problems too", () => {
    render(<ExperienceSection report={{ ...passedSample, experience: { ...passedSample.experience, ran: ["agent_ends_call"] } }} />);
    expect(screen.getByRole("region")).toHaveTextContent("Checked: how the call ends.");
    expect(screen.getByRole("region")).not.toHaveTextContent("how errors are handled");
  });

  it("pluralises the count", () => {
    const two = { ...passedSample.experience, problems: [...passedSample.experience.problems, { check: "error_handled" as const, text: "At 0:37 the agent read system details to the caller.", seqs: [12] }] };
    render(<ExperienceSection report={{ ...passedSample, experience: two }} />);
    expect(screen.getByRole("region", { name: "Call experience: 2 problems" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Show in the call" })).toHaveLength(2);
  });

  it("shows nothing when no check ran", () => {
    const { container } = render(<ExperienceSection report={{ ...passedSample, experience: { ran: [], problems: [] } }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
