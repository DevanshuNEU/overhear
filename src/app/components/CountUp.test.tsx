import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { CountUp } from "./CountUp";

// Under reduced motion the component must skip the animation and show the final
// value, which is also the SSR / first-paint value. Stub matchMedia to that path
// (jsdom has no matchMedia by default).
beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false;
    },
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("CountUp", () => {
  it("renders the final value immediately under reduced motion (SSR-safe, no stuck 0)", () => {
    render(<CountUp value={94} suffix="%" />);
    expect(screen.getByText(/94%/)).toBeInTheDocument();
  });
});
