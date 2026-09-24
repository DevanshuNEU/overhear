import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CountUp } from "./CountUp";

describe("CountUp", () => {
  it("renders the final value immediately (SSR-safe, no stuck 0)", () => {
    render(<CountUp value={94} suffix="%" />);
    expect(screen.getByText(/94%/)).toBeInTheDocument();
  });
});
