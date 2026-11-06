import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { markQuotes } from "./highlight";

const marks = (text: string, quotes: string[]) => {
  const { container } = render(<p>{markQuotes(text, quotes, "x")}</p>);
  return { marks: Array.from(container.querySelectorAll("mark")).map((m) => m.textContent), text: container.textContent };
};

describe("markQuotes", () => {
  it("marks each quote and keeps every word of the turn", () => {
    const r = marks("You're set. Your booking is confirmed. Bye now.", ["Your booking is confirmed"]);
    expect(r.marks).toEqual(["Your booking is confirmed"]);
    expect(r.text).toBe("You're set. Your booking is confirmed. Bye now.");
  });
  it("marks two quotes with the same words once", () => {
    expect(marks("It is done.", ["It is done", "It is done"]).marks).toEqual(["It is done"]);
  });
  it("merges quotes that overlap, so no tail words are left unmarked", () => {
    const r = marks("I will book you now, then transfer you.", ["I will book you now", "book you now, then transfer"]);
    expect(r.marks).toEqual(["I will book you now, then transfer"]);
    expect(r.text).toBe("I will book you now, then transfer you.");
  });
  it("ignores a quote that is not in the text", () => {
    expect(marks("Hello there.", ["goodbye"]).marks).toEqual([]);
  });
});
