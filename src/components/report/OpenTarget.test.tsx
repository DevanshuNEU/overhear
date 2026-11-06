import { describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { OpenTarget } from "./OpenTarget";

describe("OpenTarget", () => {
  it("opens the closed details around the element the address points at", () => {
    window.location.hash = "#inside";
    const { container } = render(
      <>
        <OpenTarget />
        <details>
          <summary>one</summary>
          <details>
            <summary>two</summary>
            <p id="inside">here</p>
          </details>
        </details>
      </>,
    );
    for (const d of container.querySelectorAll("details")) expect(d.open).toBe(true);
  });

  it("does the same when the address changes later", () => {
    window.location.hash = "";
    const { container } = render(
      <>
        <OpenTarget />
        <details>
          <summary>one</summary>
          <p id="later">here</p>
        </details>
      </>,
    );
    expect(container.querySelector("details")!.open).toBe(false);
    act(() => {
      window.location.hash = "#later";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(container.querySelector("details")!.open).toBe(true);
  });

  it("does nothing for an address that names nothing", () => {
    window.location.hash = "#nothing-here";
    const { container } = render(
      <>
        <OpenTarget />
        <details>
          <summary>one</summary>
        </details>
      </>,
    );
    expect(container.querySelector("details")!.open).toBe(false);
  });
});
