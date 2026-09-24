import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Reveal } from "./Reveal";

// Stub matchMedia to the reduced-motion path (jsdom has none), so Reveal shows
// its children without needing IntersectionObserver.
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

describe("Reveal", () => {
  it("renders its children (visible under reduced motion, no IntersectionObserver needed)", () => {
    render(
      <Reveal>
        <p>hello</p>
      </Reveal>,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
