import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreBadge } from "./ScoreBadge";

// Silent until it alarms: a good score is calm (no alarm color), a mixed score
// warms to amber, a poor score glows red and pulses.
describe("ScoreBadge", () => {
  it("stays calm for scores 80 and above (no alarm color)", () => {
    render(<ScoreBadge composite={85} />);
    const badge = screen.getByText("85");
    expect(badge.className).toMatch(/text-foreground/);
    expect(badge.className).not.toMatch(/alarm/);
  });

  it("warms to amber for scores between 50 and 79", () => {
    render(<ScoreBadge composite={65} />);
    expect(screen.getByText("65").className).toMatch(/alarm-amber/);
  });

  it("alarms red and pulses for scores below 50", () => {
    render(<ScoreBadge composite={30} />);
    const badge = screen.getByText("30");
    expect(badge.className).toMatch(/alarm-red/);
    expect(badge.className).toMatch(/alarm-pulse/);
  });

  it("rounds a fractional composite score for display", () => {
    render(<ScoreBadge composite={79.5} />);
    expect(screen.getByText("80")).toBeInTheDocument();
  });

  it("treats the boundary values as the higher band", () => {
    render(<ScoreBadge composite={80} />);
    expect(screen.getByText("80").className).toMatch(/text-foreground/);

    render(<ScoreBadge composite={50} />);
    expect(screen.getByText("50").className).toMatch(/alarm-amber/);
  });
});
