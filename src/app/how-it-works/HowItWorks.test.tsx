import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HowItWorks from "./page";

describe("/how-it-works", () => {
  it("answers the four honest questions (as FAQ headings)", () => {
    render(<HowItWorks />);
    // Query by heading to disambiguate: some phrases (e.g. "non-deterministic")
    // also appear in the answer prose below the question.
    expect(screen.getByRole("heading", { name: /can an ai judge an ai/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /what are the guarantees/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /is it really reliable/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /non-deterministic/i })).toBeInTheDocument();
  });
});
