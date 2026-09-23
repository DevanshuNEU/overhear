import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TryItCard } from "./TryItCard";
import { DEMO_PERSONAS } from "@/demo/personas";

describe("TryItCard", () => {
  it("lists every demo persona with its date of birth", () => {
    render(<TryItCard />);
    for (const persona of DEMO_PERSONAS) {
      expect(screen.getByText(persona.name)).toBeInTheDocument();
      expect(screen.getByText(persona.dob)).toBeInTheDocument();
    }
  });

  it("tells the visitor how to place a working call", () => {
    render(<TryItCard />);
    expect(screen.getByText(/say you are one of these patients/i)).toBeInTheDocument();
  });
});
