import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrustCards } from "./TrustCards";

describe("TrustCards", () => {
  it("renders the four honest trust points", () => {
    render(<TrustCards />);
    expect(screen.getByText(/check facts in code/i)).toBeInTheDocument();
    expect(screen.getByText(/ground the ai in the true state/i)).toBeInTheDocument();
    expect(screen.getByText(/measure the ai against a labeled set/i)).toBeInTheDocument();
    expect(screen.getByText(/show you what it missed/i)).toBeInTheDocument();
  });
});
