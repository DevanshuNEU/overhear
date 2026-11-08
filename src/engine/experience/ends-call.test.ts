// @vitest-environment node
// agent_ends_call: a goodbye loop and a line left open after the closing, on hand-built calls.
import { describe, expect, it } from "vitest";
import { ExperienceProblemSchema } from "@/report/schema";
import { ev, type ItemSpec } from "../testing/build";
import { CLOSING_PHRASES, GOODBYE_LOOP_MIN_TURNS, agentEndsCall, isGoodbye } from "./ends-call";

const agent = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "agent", text, startSec, interrupted: null });
const caller = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "caller", text, startSec, interrupted: null });
const call: ItemSpec = { kind: "tool_call", id: "tc_1", name: "lookup", args: {} };

/** A call from its items and the reason it ended: the caller hung up unless told otherwise, null for no reason in the record. */
const run = (items: ItemSpec[], reason: string | null = "user_hangup") => agentEndsCall(ev(items, { callFields: reason === null ? {} : { disconnection_reason: reason } }));
const LOOP: ItemSpec[] = [agent("Have a great day!", 5), caller("Goodbye!", 8), agent("Goodbye!", 10), caller("Bye.", 13), agent("Bye!", 15)];

describe("agentEndsCall", () => {
  it("one goodbye then the caller hanging up: ran, no problems", () => {
    const out = run([agent("How can I help?", 1), caller("Nothing, thanks.", 5), agent("Have a great day!", 8), caller("Bye.", 12)], "user_hangup");
    expect(out).toEqual({ ran: true, problems: [] });
  });

  it("a goodbye loop: one problem citing every agent turn in the closing run", () => {
    const out = run(
      [agent("Anything else?", 1), caller("No.", 3), agent("Have a great day!", 5), caller("Goodbye!", 8), agent("Goodbye!", 10), caller("Bye.", 13), agent("Bye!", 15)],
      "user_hangup",
    );
    expect(out.ran).toBe(true);
    expect(out.problems).toEqual([
      { check: "agent_ends_call", text: "The agent said goodbye 3 times (at 0:05, 0:10 and 0:15) and didn't end the call.", seqs: [3, 5, 7] },
    ]);
  });

  it("a loop is reported only when the record shows the agent did not end the call", () => {
    expect(run(LOOP, "user_hangup").problems).toHaveLength(1);
    expect(run(LOOP, "inactivity").problems.map((p) => p.seqs)).toEqual([[1, 3, 5], [5]]);
    expect(run(LOOP, "agent_hangup")).toEqual({ ran: true, problems: [] });
    expect(run(LOOP, "call_transfer")).toEqual({ ran: true, problems: [] });
    expect(run(LOOP, null)).toEqual({ ran: true, problems: [] });
  });

  it("the threshold is three agent turns", () => {
    expect(GOODBYE_LOOP_MIN_TURNS).toBe(3);
  });

  it("a two-goodbye closing is how a call normally ends: no problem", () => {
    expect(run([agent("Have a great day!", 4), caller("You too. Bye.", 7), agent("Goodbye!", 9)], "user_hangup")).toEqual({ ran: true, problems: [] });
    expect(run([agent("Take care!", 4), agent("Goodbye!", 9)])).toEqual({ ran: true, problems: [] });
  });

  it("three goodbyes is a loop, worded for three", () => {
    const out = run([agent("Take care!", 4), caller("Bye.", 6), agent("Goodbye!", 9), agent("Bye!", 11)]);
    expect(out.problems.map((p) => p.text)).toEqual(["The agent said goodbye 3 times (at 0:04, 0:09 and 0:11) and didn't end the call."]);
  });

  it("uses turn numbers when the record has no times", () => {
    const out = run([agent("Hi"), caller("Hi"), agent("Goodbye!"), caller("Bye"), agent("Goodbye!"), caller("Bye"), agent("Goodbye!")]);
    expect(out.problems[0].text).toBe("The agent said goodbye 3 times (at turn 3, turn 5 and turn 7) and didn't end the call.");
  });

  it("tool calls and events between the goodbyes do not break the closing run", () => {
    const out = run([agent("Goodbye!", 1), call, { kind: "tool_result", id: "tc_1", ok: null, platformOk: true, payload: {} }, agent("Take care!", 6), agent("Bye!", 8)]);
    expect(out.problems.map((p) => p.seqs)).toEqual([[1, 4, 5]]);
  });

  it("an early closing followed by more substance is not a loop", () => {
    const out = run(
      [agent("All set. Have a great day!", 1), caller("Wait, one more thing.", 4), agent("Of course, what is it?", 6), caller("Is there parking?", 9), agent("Yes, it's free. Goodbye!", 12)],
      "user_hangup",
    );
    expect(out).toEqual({ ran: true, problems: [] });
  });

  it("an early goodbye loop that the call moved on from is not a closing run", () => {
    const out = run([agent("Goodbye!", 1), caller("Wait.", 3), agent("Goodbye!", 5), agent("Bye!", 6), caller("Actually, one more thing.", 8), agent("Sure, go ahead.", 10)]);
    expect(out).toEqual({ ran: true, problems: [] });
  });

  it("a goodbye then inactivity: the line was left open, citing that turn", () => {
    const out = run([agent("Anything else?", 1), caller("No.", 3), agent("Have a great day!", 5)], "inactivity");
    expect(out.problems).toEqual([
      { check: "agent_ends_call", text: "The agent said goodbye at 0:05, then left the line open until the call timed out.", seqs: [3] },
    ]);
  });

  it("inactivity after a loop gives both problems", () => {
    const out = run([agent("Goodbye!", 1), caller("Bye.", 4), agent("Goodbye!", 6), caller("Bye.", 8), agent("Bye!", 10)], "inactivity");
    expect(out.problems.map((p) => p.seqs)).toEqual([[1, 3, 5], [5]]);
  });

  it("inactivity with no closing at the end is not a line left open", () => {
    expect(run([agent("Goodbye!", 1), caller("Wait, what about Friday?", 4), agent("Let me check.", 6)], "inactivity").problems).toEqual([]);
  });

  it("a caller turn after the last goodbye does not hide the line left open", () => {
    expect(run([agent("Goodbye!", 1), caller("Hello?", 4)], "inactivity").problems).toHaveLength(1);
  });

  it("no agent turns: the check did not run", () => {
    expect(run([caller("Hello?", 1)])).toEqual({ ran: false, problems: [] });
    expect(run([])).toEqual({ ran: false, problems: [] });
  });

  it("a caller's goodbyes alone are not the agent's", () => {
    expect(run([agent("Anything else?", 1), caller("Goodbye!", 3), caller("Bye!", 4)])).toEqual({ ran: true, problems: [] });
  });

  it("every problem cites only agent turns and validates", () => {
    const e = ev([agent("Anything else?", 1), caller("Goodbye!", 3), agent("Goodbye!", 5), caller("Bye", 7), agent("Bye!", 9), agent("Take care!", 11)], { callFields: { disconnection_reason: "inactivity" } });
    const out = agentEndsCall(e);
    expect(out.problems.length).toBeGreaterThan(0);
    for (const p of out.problems) {
      ExperienceProblemSchema.parse(p);
      for (const seq of p.seqs) expect(e.items.find((it) => it.seq === seq)).toMatchObject({ kind: "turn", role: "agent" });
    }
  });
});

describe("isGoodbye", () => {
  it.each(CLOSING_PHRASES.map((p) => [p]))("matches %s, any case", (phrase) => {
    expect(isGoodbye(`Okay, ${phrase.toUpperCase()}!`)).toBe(true);
    expect(isGoodbye(phrase)).toBe(true);
  });

  it.each(["Goodbyes are hard.", "I'll check the bybye list", "That is a maybe.", "Hello there.", "Bye2", "ebye", "ByeBye", "Byeee"])("does not match %s", (text) => {
    expect(isGoodbye(text)).toBe(false);
  });

  it("does not read 'take care to' as a closing", () => {
    expect(isGoodbye("Please take care to bring your card.")).toBe(false);
    expect(isGoodbye("Take care to arrive early. Take care!")).toBe(true);
  });

  it("does not read 'take care of' as a closing", () => {
    expect(isGoodbye("I'll take care of that booking now.")).toBe(false);
    expect(isGoodbye("Take care of yourself!")).toBe(false);
    expect(isGoodbye("Take care, Sofia.")).toBe(true);
  });
});
