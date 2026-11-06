import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { markQuotes, sentencesOf, windowAround } from "./highlight";

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

describe("sentencesOf", () => {
  it("splits on sentence ends, including where a stream left no space, and keeps the words", () => {
    expect(sentencesOf("Booked for nine.You're all set! Anything else?")).toEqual(["Booked for nine.", "You're all set!", "Anything else?"]);
  });
  it("does not split after a title or an abbreviation", () => {
    expect(sentencesOf("I will book you with Dr. Nair at 9:00 a.m. on Friday. Thanks.")).toEqual(["I will book you with Dr. Nair at 9:00 a.m. on Friday.", "Thanks."]);
  });
  it("gives text with no end mark as one sentence", () => {
    expect(sentencesOf("Got it, I'll book you with")).toEqual(["Got it, I'll book you with"]);
  });
});

describe("windowAround", () => {
  const text = "One. Two. Three claim here. Four. Five. Six.";
  it("is the sentence that holds the claim and one either side", () => {
    expect(windowAround(text, ["claim here"])).toEqual({ text: "Two. Three claim here. Four.", hidden: true });
  });
  it("is null when the window already covers the whole turn, so nothing is hidden", () => {
    expect(windowAround("One. Two claim. Three.", ["claim"])).toBeNull();
  });
  it("covers every claim in the turn, with one sentence either side of the first and the last", () => {
    expect(windowAround("A1. A2. A3. A4. A5. A6. A7. A8. A9.", ["A3", "A6"])).toEqual({ text: "A2. A3. A4. A5. A6. A7.", hidden: true });
  });
  it("is null when there is no claim to centre on, or the claim is not in the text", () => {
    expect(windowAround(text, [])).toBeNull();
    expect(windowAround(text, ["nowhere"])).toBeNull();
  });
});
