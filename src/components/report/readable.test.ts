import { describe, expect, it } from "vitest";
import { readableSegments, readableSpans } from "./readable";

/** The turn as read: converted spans as their digits, the rest as written. */
const shown = (text: string) => readableSegments(text).map((s) => s.shown).join("");
/** Only the converted spans, as [shown, exact]. */
const converted = (text: string) => readableSegments(text).filter((s) => s.shown !== s.exact).map((s) => [s.shown, s.exact]);

describe("readableSegments", () => {
  it("reads a date of birth as a date, and keeps the exact words", () => {
    const text = "My date of birth is fourteenth of March nineteen eighty five, thanks.";
    expect(shown(text)).toBe("My date of birth is March 14, 1985, thanks.");
    expect(converted(text)).toEqual([["March 14, 1985", "fourteenth of March nineteen eighty five"]]);
  });

  it("reads the month-first order and a date with no year", () => {
    expect(converted("It's March fourteenth nineteen eighty five.")).toEqual([["March 14, 1985", "March fourteenth nineteen eighty five"]]);
    expect(converted("How about the fifth of July?")).toEqual([["July 5", "the fifth of July"]]);
    expect(converted("On March twenty first we open.")).toEqual([["March 21", "March twenty first"]]);
  });

  it("takes a year written in digits after a spoken day", () => {
    expect(converted("March fourteenth, 1985")).toEqual([["March 14, 1985", "March fourteenth, 1985"]]);
  });

  it("leaves a day that is not on the calendar as written", () => {
    expect(shown("the thirty first of April")).toBe("the thirty first of April");
    expect(shown("the thirtieth of February")).toBe("the thirtieth of February");
  });

  it("does not read the day of an impossible date as a lone ordinal", () => {
    expect(shown("April thirty first")).toBe("April thirty first");
    expect(shown("the thirty first of April")).toBe("the thirty first of April");
  });

  it("needs a capital for May in the month-first order, so a verb is not a month", () => {
    expect(shown("you may second guess it")).toBe("you may second guess it");
    expect(shown("May second works")).toBe("May 2 works");
    expect(shown("the second of may")).toBe("May 2");
  });

  it("reads a phone number said digit by digit", () => {
    const text = "It's five five five one two three four.";
    expect(shown(text)).toBe("It's 555 1234.");
    expect(converted(text)).toEqual([["555 1234", "five five five one two three four"]]);
    expect(shown("Call five five five, one two three, four five six seven")).toBe("Call 555, 123, 4567");
  });

  it("groups ten digits and 911, and reads zero", () => {
    expect(shown("six one seven five five five zero one nine nine")).toBe("617 555 0199");
    expect(shown("dial nine one one")).toBe("dial 911");
    expect(shown("zero two one one five")).toBe("02115");
  });

  it("leaves a digit run that starts or ends on oh as written, since oh may be a word", () => {
    expect(shown("oh five five five one two three four")).toBe("oh five five five one two three four");
    expect(shown("five five five one two three four oh")).toBe("five five five one two three four oh");
    expect(shown("two oh one")).toBe("201");
  });

  it("leaves one or two digit words as written", () => {
    expect(shown("I need one more minute")).toBe("I need one more minute");
    expect(shown("five five")).toBe("five five");
  });

  it("reads years", () => {
    expect(converted("born in nineteen ninety")).toEqual([["1990", "nineteen ninety"]]);
    expect(shown("in twenty twenty four")).toBe("in 2024");
    expect(shown("in two thousand twelve")).toBe("in 2012");
    expect(shown("in nineteen oh five")).toBe("in 1905");
  });

  it("reads ordinals that cannot be a figure of speech, and leaves first to twelfth", () => {
    expect(shown("the twenty second floor")).toBe("the 22nd floor");
    expect(shown("on the fourteenth")).toBe("on the 14th");
    expect(shown("the twenty third")).toBe("the 23rd");
    expect(shown("first of all, the second time")).toBe("first of all, the second time");
  });

  it("reads plain cardinals of two words or more, and single words from ten up", () => {
    expect(converted("It costs twenty two dollars")).toEqual([["22", "twenty two"]]);
    expect(shown("twenty-two")).toBe("22");
    expect(shown("one hundred and five")).toBe("105");
    expect(shown("two hundred fifty")).toBe("250");
    expect(shown("two thousand five hundred")).toBe("2,500");
    expect(shown("about forty minutes")).toBe("about 40 minutes");
  });

  it("leaves single digit words as written", () => {
    expect(shown("two people, one moment, nine of them")).toBe("two people, one moment, nine of them");
  });

  it("leaves 'two' in 'I want to go' alone: to is not a number", () => {
    expect(shown("I want to go")).toBe("I want to go");
    expect(shown("I want two to go, too")).toBe("I want two to go, too");
  });

  it("leaves a number next to other number words as written, since the reading is unsure", () => {
    expect(shown("at ten thirty")).toBe("at ten thirty");
    expect(shown("five five five twenty two")).toBe("five five five twenty two");
    expect(shown("twenty twenty four hundred")).toBe("twenty twenty four hundred");
  });

  it("leaves words that only contain a number word alone", () => {
    expect(shown("someone, anyone, stone, tone, ones, twenties")).toBe("someone, anyone, stone, tone, ones, twenties");
    expect(shown("one's twenty's")).toBe("one's twenty's");
  });

  it("converts several spans in one turn", () => {
    expect(shown("Born nineteen eighty five, call five five five one two three four, room twenty two.")).toBe("Born 1985, call 555 1234, room 22.");
  });

  it("keeps the text of a turn whole: shown plus the rest, and exact joins back to the original", () => {
    const text = "Is that fourteenth of March nineteen eighty five? Yes, and it's twenty two, right?";
    expect(readableSegments(text).map((s) => s.exact).join("")).toBe(text);
  });

  it("leaves an empty turn, and a turn with no numbers, as one plain segment", () => {
    expect(readableSegments("")).toEqual([]);
    expect(readableSegments("Hello there.")).toEqual([{ shown: "Hello there.", exact: "Hello there." }]);
  });

  it("is not thrown by digits, punctuation or capitals", () => {
    expect(shown("Twenty Two.")).toBe("22.");
    expect(shown("Call 555 1234 or room 12, March 14.")).toBe("Call 555 1234 or room 12, March 14.");
  });
});

describe("precision: a wrong digit is worse than a word left as written", () => {
  it("leaves compound ordinals above thirty whole, never cut in half", () => {
    expect(shown("forty second street")).toBe("forty second street");
    expect(shown("the fifty first state")).toBe("the fifty first state");
    expect(shown("ninety ninth percentile")).toBe("ninety ninth percentile");
    expect(shown("sixty sixth")).toBe("sixty sixth");
  });

  it("reads a lone ordinal only after 'the', never after 'a' or 'an'", () => {
    expect(shown("a thirty second wait")).toBe("a thirty second wait");
    expect(shown("a twenty second delay")).toBe("a twenty second delay");
    expect(shown("an twenty second pause")).toBe("an twenty second pause");
    expect(shown("on the twenty second")).toBe("on the 22nd");
    expect(shown("the twenty second floor")).toBe("the 22nd floor");
    expect(shown("twenty second")).toBe("twenty second");
  });

  it("leaves a run after double or triple as written", () => {
    expect(shown("double five one two")).toBe("double five one two");
    expect(shown("triple five one two three four")).toBe("triple five one two three four");
    expect(shown("five five five one two double three four")).toBe("five five five one two double three four");
  });

  it("reads a bare year only after a year cue", () => {
    expect(shown("born in nineteen eighty five")).toBe("born in 1985");
    expect(shown("since twenty twenty four")).toBe("since 2024");
    expect(shown("the year nineteen ninety")).toBe("the year 1990");
    expect(shown("a man born nineteen sixty")).toBe("a man born 1960");
    expect(shown("one of twenty twenty")).toBe("one of 2020");
    expect(shown("my date of birth is nineteen eighty five")).toBe("my date of birth is 1985");
    expect(shown("birth date is nineteen eighty five")).toBe("birth date is 1985");
  });

  it("leaves prices and times that look like years as written", () => {
    expect(shown("nineteen ninety nine dollars")).toBe("nineteen ninety nine dollars");
    expect(shown("it's twenty thirty")).toBe("it's twenty thirty");
    expect(shown("that'll be nineteen fifty")).toBe("that'll be nineteen fifty");
    expect(shown("the code is nineteen eighty five")).toBe("the code is nineteen eighty five");
    expect(shown("it is nineteen eighty five")).toBe("it is nineteen eighty five");
  });

  it("still reads a year inside a date, with no cue needed", () => {
    expect(shown("It's March fourteenth nineteen eighty five.")).toBe("It's March 14, 1985.");
  });

  it("does not convert half of a phrase joined by 'and' after hundred or thousand", () => {
    expect(shown("about a hundred and fifty")).toBe("about a hundred and fifty");
    expect(shown("one hundred and first")).toBe("one hundred and first");
    expect(shown("a thousand and fifty")).toBe("a thousand and fifty");
    expect(shown("one hundred and five")).toBe("105");
  });

  it("leaves hundreds of eleven to nineteen as written", () => {
    expect(shown("nineteen hundred and five")).toBe("nineteen hundred and five");
    expect(shown("nineteen hundred hours")).toBe("nineteen hundred hours");
    expect(shown("fifteen hundred")).toBe("fifteen hundred");
    expect(shown("two hundred fifty")).toBe("250");
  });
});

describe("readableSpans with exact ranges", () => {
  it("drops a span that touches a range that must stay exact", () => {
    const text = "Your date is fourteenth of March nineteen eighty five.";
    const at = text.indexOf("March");
    expect(readableSpans(text, [{ start: at, end: at + 5 }])).toEqual([]);
    expect(readableSpans(text, [])).toHaveLength(1);
  });

  it("keeps a span that lies clear of the range", () => {
    const text = "I am twenty two. You said hello.";
    const at = text.indexOf("hello");
    expect(readableSpans(text, [{ start: at, end: at + 5 }]).map((s) => s.shown)).toEqual(["22"]);
  });
});
