import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { markQuotes, markedRanges, sentencesOf, windowAround } from "./highlight";
import { readableSegments } from "./readable";

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

describe("markQuotes with readable numbers", () => {
  const view = (text: string, quotes: string[], readable = true) => {
    const { container } = render(<p>{markQuotes(text, quotes, "x", { readable })}</p>);
    return container;
  };

  it("shows a spoken number as digits and holds the exact words for assistive tech and the tooltip", () => {
    const c = view("My date of birth is fourteenth of March nineteen eighty five, thanks.", []);
    const span = c.querySelector("[data-readable]")!;
    expect(span.getAttribute("title")).toBe("fourteenth of March nineteen eighty five");
    expect(span.querySelector("[data-digits]")!.getAttribute("aria-hidden")).toBe("true");
    expect(span.querySelector("[data-digits]")!.textContent).toBe("March 14, 1985");
    expect(span.querySelector("[data-exact]")!.textContent).toBe("fourteenth of March nineteen eighty five");
    expect(c.textContent).toBe("My date of birth is March 14, 1985fourteenth of March nineteen eighty five, thanks.");
  });

  it("leaves the words as spoken when asked to", () => {
    const c = view("It's five five five one two three four.", [], false);
    expect(c.querySelector("[data-readable]")).toBeNull();
    expect(c.textContent).toBe("It's five five five one two three four.");
  });

  it("shows a highlighted quote with its exact words, never converted ones", () => {
    const text = "Your booking is for the fourteenth of March, and your code is two two seven.";
    const c = view(text, ["booking is for the fourteenth of March"]);
    expect(Array.from(c.querySelectorAll("mark")).map((m) => m.textContent)).toEqual(["booking is for the fourteenth of March"]);
    expect(c.querySelector("mark [data-readable]")).toBeNull();
    // The words outside the quote still read as digits.
    expect(c.querySelector("[data-readable] [data-digits]")!.textContent).toBe("227");
  });

  it("leaves a converted span as written when a quote cuts across it", () => {
    const text = "It is the fourteenth of March nineteen eighty five today.";
    const c = view(text, ["March nineteen"]);
    expect(c.querySelector("[data-readable]")).toBeNull();
    expect(c.textContent).toBe(text);
  });

  it("changes no word of an empty turn", () => {
    expect(view("", []).textContent).toBe("");
  });

  it("keeps the segments' exact words identical to the turn", () => {
    const text = "Call five five five one two three four on the twenty second.";
    expect(readableSegments(text).map((s) => s.exact).join("")).toBe(text);
  });

  it("uses the spans it is given, so a caller that already read the turn does not read it twice", () => {
    const text = "Call five five five one two three four now.";
    const at = text.indexOf("five");
    const c = render(<p>{markQuotes(text, [], "x", { spans: [{ start: at, end: text.indexOf(" now"), shown: "555 1234", exact: text.slice(at, text.indexOf(" now")) }] })}</p>).container;
    expect(c.querySelector("[data-readable] [data-digits]")!.textContent).toBe("555 1234");
  });
});

describe("markedRanges", () => {
  it("is the merged ranges markQuotes marks, with the class of the quote listed first", () => {
    const text = "I will book you now, then transfer you.";
    const ranges = markedRanges(text, [{ quote: "I will book you now", markClass: "a" }, { quote: "book you now, then transfer", markClass: "b" }, "not here"], "z");
    expect(ranges).toEqual([{ start: 0, end: 34, markClass: "a", order: 0 }]);
  });
  it("is empty for no quotes", () => {
    expect(markedRanges("Hello.", [], "x")).toEqual([]);
  });
});
