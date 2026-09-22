import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreBadge } from "./ScoreBadge";

describe("ScoreBadge", () => {
  it("renders emerald for scores 80 and above", () => {
    render(<ScoreBadge composite={85} />);
    const badge = screen.getByText("85");
    expect(badge.className).toMatch(/emerald/);
  });

  it("renders amber for scores between 50 and 79", () => {
    render(<ScoreBadge composite={65} />);
    const badge = screen.getByText("65");
    expect(badge.className).toMatch(/amber/);
  });

  it("renders rose for scores below 50", () => {
    render(<ScoreBadge composite={30} />);
    const badge = screen.getByText("30");
    expect(badge.className).toMatch(/rose/);
  });

  it("rounds a fractional composite score for display", () => {
    render(<ScoreBadge composite={79.5} />);
    expect(screen.getByText("80")).toBeInTheDocument();
  });

  it("treats the boundary values as the higher band", () => {
    render(<ScoreBadge composite={80} />);
    expect(screen.getByText("80").className).toMatch(/emerald/);

    render(<ScoreBadge composite={50} />);
    expect(screen.getByText("50").className).toMatch(/amber/);
  });
});
