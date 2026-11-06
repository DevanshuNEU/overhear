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

  it("does not break on an address with a malformed escape", () => {
    window.location.hash = "#%";
    expect(() => render(<OpenTarget />)).not.toThrow();
  });

  it("opens the row again when the same link is clicked after the row was closed", () => {
    window.location.hash = "#again";
    const { container } = render(
      <>
        <OpenTarget />
        <a href="#again">go</a>
        <details open>
          <summary>one</summary>
          <p id="again">here</p>
        </details>
      </>,
    );
    const details = container.querySelector("details")!;
    details.open = false;
    container.querySelector("a")!.click();
    expect(details.open).toBe(true);
  });
});
