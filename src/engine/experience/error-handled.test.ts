// @vitest-environment node
// error_handled: system details read to the caller, and a failed tool the agent gave no way forward from.
import { describe, expect, it } from "vitest";
import { ExperienceProblemSchema, type Evidence } from "@/report/schema";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { loadCases } from "../../../scripts/engine-evals/io";
import { analyzeRetellCall } from "../analyze";
import { detectAll } from "../detect-speech";
import { ev, type ItemSpec } from "../testing/build";
import { LEAK_PHRASES, WAY_FORWARD_PHRASES, errorHandled } from "./error-handled";

const agent = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "agent", text, startSec, interrupted: null });
const caller = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "caller", text, startSec, interrupted: null });
const call: ItemSpec = { kind: "tool_call", id: "tc_1", name: "schedule_appointment", args: {} };
const failed: ItemSpec = { kind: "tool_result", id: "tc_1", ok: false, platformOk: false, payload: { error: "boom" } };
const worked: ItemSpec = { kind: "tool_result", id: "tc_1", ok: true, platformOk: true, payload: {} };

/** The check on a call, with the detections the engine would hand it. */
const run = (items: ItemSpec[], toolNames: string[] = ["schedule_appointment"]) => {
  const e = ev(items);
  return errorHandled(e, { detections: detectAll(e, toolNames) });
};

const OUTAGE: ItemSpec[] = [
  agent("Let me book that for you.", 1),
  call,
  failed,
  agent("It looks like the scheduling system returned a temporary error. Please try again shortly.", 6),
];

describe("errorHandled: the outage shape", () => {
  it("a failed tool, the error read aloud and nothing to do next: both problems", () => {
    const out = run(OUTAGE);
    expect(out.ran).toBe(true);
    expect(out.problems).toEqual([
      { check: "error_handled", text: 'At 0:06 the agent read system details to the caller: "returned a temporary error".', seqs: [4] },
      { check: "error_handled", text: "A tool failed at 0:01, and the agent offered no way forward: no callback, no person to talk to, no time to try again.", seqs: [4] },
    ]);
  });

  it("the same with a callback offered: only the leaked internals", () => {
    const out = run([...OUTAGE.slice(0, 3), agent("It looks like the scheduling system returned a temporary error. I can have someone call you back when it's back up.", 6)]);
    expect(out.problems.map((p) => p.text)).toEqual(['At 0:06 the agent read system details to the caller: "returned a temporary error".']);
  });

  it("a failed tool then a transfer to a staff member: no problems", () => {
    expect(run([agent("One moment.", 1), call, failed, agent("Let me transfer you to a staff member.", 5)])).toEqual({ ran: true, problems: [] });
  });

  it("a way forward in a later turn counts", () => {
    const out = run([call, failed, agent("Sorry, that did not work.", 3), caller("Oh no.", 5), agent("A nurse will call you back today.", 7)]);
    expect(out.problems).toEqual([]);
  });

  it("a failed backend action is a failure too", () => {
    const action: ItemSpec = { kind: "backend_action", id: null, toolCallId: null, tool: "schedule", args: {}, result: {}, ok: false, ts: "2025-01-01T00:00:00Z", link: null };
    const out = run([agent("Booking now.", 1), action, agent("I could not do that. Please try again shortly.", 5)]);
    expect(out.problems.map((p) => p.text)).toEqual(["A tool failed at 0:01, and the agent offered no way forward: no callback, no person to talk to, no time to try again."]);
    expect(out.problems[0].seqs).toEqual([3]);
  });
});

describe("errorHandled: no way forward", () => {
  it("cites the first agent turn after the failure, one problem per call", () => {
    const out = run([call, failed, agent("Hmm, that did not work.", 2), call, { ...failed, id: "tc_2" }, agent("Still nothing.", 6)]);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0].seqs).toEqual([3]);
  });

  it("a failure with no agent turn after it: nothing to cite, no problem", () => {
    expect(run([agent("Booking.", 1), call, failed])).toEqual({ ran: true, problems: [] });
  });

  it("a way forward before the failure does not count", () => {
    const out = run([agent("I can call you back if needed.", 1), call, failed, agent("Sorry, that failed.", 5)]);
    expect(out.problems.map((p) => p.seqs)).toEqual([[4]]);
  });

  it("a way forward inside a longer sentence counts", () => {
    expect(run([call, failed, agent("I am sorry about that, but if you like I will transfer you to the front desk right now.", 4)]).problems).toEqual([]);
  });

  it("'Please try again shortly' alone is not a way forward", () => {
    expect(run([call, failed, agent("Please try again shortly.", 4)]).problems).toHaveLength(1);
  });

  it("a time to try again is a way forward", () => {
    expect(run([call, failed, agent("Please try again in ten minutes.", 4)]).problems).toEqual([]);
  });

  it("a failure the same tool later fixed is not a failure", () => {
    const retry: ItemSpec = { kind: "tool_call", id: "tc_2", name: "schedule_appointment", args: {} };
    const out = run([call, failed, agent("Let me try that once more.", 3), retry, { ...worked, id: "tc_2" }, agent("You are booked.", 8)]);
    expect(out).toEqual({ ran: true, problems: [] });
  });

  it("a failed verify then a successful verify: no problem", () => {
    const v = (id: string): ItemSpec => ({ kind: "tool_call", id, name: "verify_patient", args: {} });
    const r = (id: string, ok: boolean): ItemSpec => ({ kind: "tool_result", id, ok, platformOk: ok, payload: {} });
    expect(run([v("a"), r("a", false), agent("That did not match, let me retry.", 4), v("b"), r("b", true), agent("You are verified.", 8)], ["verify_patient"])).toEqual({ ran: true, problems: [] });
  });

  it("a different tool succeeding does not resolve the failure; the first unresolved failure is used", () => {
    const other: ItemSpec = { kind: "tool_call", id: "tc_9", name: "check_availability", args: {} };
    const out = run([call, failed, agent("Sorry, that did not work.", 3), other, { ...worked, id: "tc_9" }, agent("Anyway, anything else?", 7)]);
    expect(out.problems.map((p) => p.seqs)).toEqual([[3]]);
  });

  it("a retry that fails again is still unresolved, and the first failure is the one reported", () => {
    const retry: ItemSpec = { kind: "tool_call", id: "tc_2", name: "schedule_appointment", args: {} };
    const out = run([agent("Booking now.", 1), call, failed, agent("Trying again, one moment.", 4), retry, { ...failed, id: "tc_2" }, agent("Still not working, sorry.", 8)]);
    expect(out.problems.map((p) => [p.text.slice(0, 22), p.seqs])).toEqual([["A tool failed at 0:01,", [4]]]);
  });

  it("a failed backend action fixed by a later successful action of the same tool: no problem", () => {
    const action = (ok: boolean): ItemSpec => ({ kind: "backend_action", id: null, toolCallId: null, tool: "schedule", args: {}, result: {}, ok, ts: "2025-01-01T00:00:00Z", link: null });
    expect(run([agent("Booking now.", 1), action(false), agent("One moment, retrying that.", 3), action(true), agent("You are booked.", 6)])).toEqual({ ran: true, problems: [] });
  });

  it("skips short agent fragments when picking the turn to cite; none long enough, no problem", () => {
    expect(run([call, failed, agent("I'm booking ", 3), agent("Sorry, that did not work.", 5)]).problems.map((p) => p.seqs)).toEqual([[4]]);
    expect(run([call, failed, agent("I'm booking ", 3)])).toEqual({ ran: true, problems: [] });
  });

  it("a way forward in a short fragment still counts", () => {
    expect(run([call, failed, agent("Sorry, that did not work.", 3), agent("A nurse ", 5)]).problems).toEqual([]);
  });

  it("a worked tool and an unsettled one need no way forward", () => {
    expect(run([call, worked, agent("All set.", 3)])).toEqual({ ran: true, problems: [] });
    expect(run([call, { ...worked, ok: null, platformOk: null }, agent("Okay.", 3)])).toEqual({ ran: true, problems: [] });
  });
});

describe("errorHandled: leaked internals", () => {
  const leaks = (text: string) => run([agent(text, 3)]).problems.map((p) => p.text);
  const said = (quote: string) => [`At 0:03 the agent read system details to the caller: "${quote}".`];

  it.each([...LEAK_PHRASES].map((p) => [p]))("flags the phrase %s", (phrase) => {
    expect(leaks(`Sorry, there was ${phrase} on my end.`)).toEqual(said(phrase));
  });

  it("matches phrases in any case", () => {
    expect(leaks("A System Error happened.")).toEqual(said("System Error"));
  });

  it("'null' inside 'annulled' does not count; the whole word does, in any case", () => {
    expect(leaks("Your appointment was annulled.")).toEqual([]);
    expect(leaks("The value is null.")).toEqual(said("null"));
    expect(leaks("It says Undefined here.")).toEqual(said("Undefined"));
    expect(leaks("That is undefinedly odd.")).toEqual([]);
  });

  it("API matches only as the uppercase whole word", () => {
    expect(leaks("The API did not respond.")).toEqual(said("API"));
    expect(leaks("I am rapidly checking.")).toEqual([]);
    expect(leaks("Let me check the api.")).toEqual([]);
    expect(leaks("The APIs are down.")).toEqual([]);
  });

  it("the bare word 'exception' is ordinary speech; the error phrases are not", () => {
    expect(leaks("We can make an exception for you.")).toEqual([]);
    expect(leaks("Hmm, an exception occurred.")).toEqual(said("an exception occurred"));
    expect(leaks("It threw an exception.")).toEqual(said("threw an exception"));
    expect(leaks("An exception was thrown.")).toEqual(said("exception was thrown"));
  });

  it("flags a template placeholder and quotes it", () => {
    expect(leaks("Your appointment is on {{date}} at noon.")).toEqual(said("{{date}}"));
  });

  it("flags a JSON-looking fragment", () => {
    expect(leaks('The result was {"status": "error"} I think.')).toEqual(said('{"status": "error"}'));
    expect(leaks('It said "status": failed.')).toEqual(said('"status":'));
  });

  it("a bare \":\" with no quoted key before it does not count", () => {
    expect(leaks('Okay":')).toEqual([]);
    expect(leaks('He said that" : and left.')).toEqual([]);
  });

  it("a tool call read aloud is quoted whole, its braces and JSON merged into it", () => {
    const text = 'Sure, book_appointment({"slotId": "s_1"}) is what I run.';
    const e = ev([agent(text, 2)]);
    const out = errorHandled(e, { detections: detectAll(e, ["book_appointment"]) });
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0].text).toBe('At 0:02 the agent read system details to the caller: "book_appointment({"slotId": "s_1"}".');
    expect(text).toContain('book_appointment({"slotId": "s_1"}');
  });

  it("touching and overlapping matches are one quote; separate ones each get their own pair", () => {
    expect(leaks("Got {{a}}{{b}} here.")).toEqual(said("{{a}}{{b}}"));
    expect(leaks("It was a server error and an internal error.")).toEqual(said('server error" and "internal error'));
    expect(leaks("A system error, then null, then an API error code.")).toEqual(said('system error", "null", "API" and "error code'));
  });

  it("flags a turn the detector marked as a read-out tool call, quoting the detector's quote", () => {
    const e = ev([agent("Okay, schedule_appointment(date=tomorrow) is what I run.", 2)]);
    const detections = detectAll(e, ["schedule_appointment"]);
    const syntax = detections.find((d) => d.cls === "tool_syntax");
    expect(syntax).toBeDefined();
    const out = errorHandled(e, { detections });
    expect(out.problems).toEqual([{ check: "error_handled", text: `At 0:02 the agent read system details to the caller: "${syntax?.quote}".`, seqs: [1] }]);
  });

  it("one problem per turn, listing every match", () => {
    expect(leaks("A server error, then an internal error, then server error again.")).toEqual(said('server error" and "internal error'));
    expect(run([agent("System error.", 1), caller("What?", 2), agent("Internal error.", 3)]).problems.map((p) => p.seqs)).toEqual([[1], [3]]);
  });

  it("caller turns are never flagged", () => {
    expect(run([agent("Hi.", 1), caller("Is the API null?", 2)])).toEqual({ ran: true, problems: [] });
  });

  it("uses turn numbers when the record has no times", () => {
    expect(run([agent("Hello."), caller("Hi."), agent("System error.")]).problems[0].text).toBe('At turn 3 the agent read system details to the caller: "System error".');
  });
});

describe("errorHandled: running", () => {
  it("no agent turns: did not run", () => {
    expect(run([caller("Hello?", 1)])).toEqual({ ran: false, problems: [] });
    expect(run([])).toEqual({ ran: false, problems: [] });
  });

  it("a successful ordinary call: ran, no problems", () => {
    expect(run([agent("How can I help?", 1), caller("Book me.", 3), call, worked, agent("You are booked.", 7)])).toEqual({ ran: true, problems: [] });
  });

  it("every problem cites only agent turns and validates", () => {
    const e: Evidence = ev(OUTAGE);
    const out = errorHandled(e, { detections: [] });
    expect(out.problems).toHaveLength(2);
    for (const p of out.problems) {
      ExperienceProblemSchema.parse(p);
      for (const seq of p.seqs) expect(e.items.find((it) => it.seq === seq)).toMatchObject({ kind: "turn", role: "agent" });
    }
  });

  it("the phrase lists are exported", () => {
    expect(WAY_FORWARD_PHRASES).toContain("call you back");
    expect(WAY_FORWARD_PHRASES).not.toContain("try again shortly");
    expect(LEAK_PHRASES).not.toContain("exception");
  });
});

describe("errorHandled: the samples", () => {
  const onSample = (r: typeof failedSample) => errorHandled(r.evidence, { detections: r.detections });

  it("the outage call: the scheduling error read aloud, and a callback time given", () => {
    expect(onSample(needsReviewSample)).toEqual({
      ran: true,
      problems: [{ check: "error_handled", text: 'At 0:37 the agent read system details to the caller: "returned a temporary error".', seqs: [12] }],
    });
  });

  it("the failed and passed calls: exactly what the engine finds", () => {
    expect(onSample(failedSample)).toEqual({ ran: true, problems: [] });
    expect(onSample(passedSample)).toEqual({ ran: true, problems: [] });
  });
});

describe("errorHandled: every quote is the agent's own words", () => {
  const PREFIX = /^At [^ ]+(?: \d+)? the agent read system details to the caller: /;
  /** The quoted fragments of a leaked-internals text: "a", "a" and "b", or "a", "b" and "c". */
  const fragments = (text: string): string[] => {
    const body = text.replace(PREFIX, "").replace(/\.$/, "");
    return body.slice(1, -1).split(/", "|" and "/);
  };

  it("fragments are read back from the list wording", () => {
    expect(fragments('At 0:03 the agent read system details to the caller: "a" and "b".')).toEqual(["a", "b"]);
    expect(fragments('At turn 3 the agent read system details to the caller: "a", "b" and "c".')).toEqual(["a", "b", "c"]);
  });

  it("holds on every eval case and sample that yields a leaked-internals problem", () => {
    const reports = [
      ...loadCases().flatMap((c) => {
        const out = analyzeRetellCall(c.record, { tz: c.tz ?? "UTC" });
        return out.kind === "report" ? [out.report] : [];
      }),
      failedSample,
      needsReviewSample,
      passedSample,
    ];
    let checked = 0;
    for (const r of reports) {
      for (const p of r.experience.problems.filter((q) => q.check === "error_handled" && PREFIX.test(q.text))) {
        const turn = r.evidence.items.find((it) => it.seq === p.seqs[0]);
        expect(turn?.kind).toBe("turn");
        if (turn?.kind !== "turn") continue;
        for (const f of fragments(p.text)) expect(turn.text, `fragment ${JSON.stringify(f)} of ${r.callId}`).toContain(f);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1);
  });
});
