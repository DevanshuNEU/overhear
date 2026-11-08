// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CallReportSchema,
  CONTRACT_IDS,
  EXPERIENCE_CHECKS,
  GAP_CODES,
  NOTES,
  RESULTS,
  VERDICTS,
  claimClass,
  type CallReport,
} from "./schema";
import { CONTRACT_TITLE, EXPERIENCE_TITLE, NOTE_LINE, RESULT_LABEL, VERDICT_LABEL, headlineFor } from "./labels";
import { SAMPLE_REPORTS, failedSample, needsReviewSample, passedSample } from "./samples";

/** A deep copy, so a test can break one field without touching the shared sample. */
const clone = <T>(v: T): T => structuredClone(v);
/** Every validation problem as "path: message", or an empty list when the report is valid. */
const issues = (report: unknown) => {
  const r = CallReportSchema.safeParse(report);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
};
/** One contract's result entry by id. */
const result = (r: CallReport, id: string) => r.results.find((x) => x.contract === id)!;

describe("sample reports", () => {
  it("are one failed, one needs review and one passed call", () => {
    expect(SAMPLE_REPORTS.map((r) => r.verdict).sort()).toEqual(["failed", "needs_review", "passed"]);
  });

  it.each(SAMPLE_REPORTS.map((r) => [r.verdict, r] as const))("%s sample validates against the schema", (_v, report) => {
    expect(issues(report)).toEqual([]);
  });

  it("are the same files the engine writes: raw JSON on disk parses to the exported objects", () => {
    for (const [file, sample] of [
      ["failed.json", failedSample],
      ["needs-review.json", needsReviewSample],
      ["passed.json", passedSample],
    ] as const) {
      const onDisk = JSON.parse(fs.readFileSync(path.join(__dirname, "samples", file), "utf8"));
      expect(onDisk).toEqual(sample);
    }
  });

  it("carry no links, emails, phone numbers or credentials", () => {
    for (const report of SAMPLE_REPORTS) {
      const text = JSON.stringify(report);
      expect(text).not.toMatch(/https?:\/\//i);
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(text).not.toMatch(/\+\d{10,}|\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/); // phone numbers
      expect(text).not.toMatch(/access_token|recording|api[_-]?key|bearer/i);
      // Every uuid is one of the obviously fake ones, so no production id leaks.
      for (const id of text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []) {
        expect(id).toMatch(/^00000000-0000-4000-8000-\d{12}$/);
      }
    }
  });

  it("never reuse a real Retell call id", () => {
    for (const report of SAMPLE_REPORTS) {
      expect(report.callId).toMatch(/^call_sample_/);
      expect(report.evidence.callId).toBe(report.callId);
    }
  });

  it("show a passed call that still says the caller's request was not checked", () => {
    expect(passedSample.notes).toEqual(["request_not_checked"]);
    expect(result(passedSample, "committed_matches_request").result).toBe("not_run");
  });

  it("show the failed call's decisive turn next to what the system did", () => {
    const transfer = result(failedSample, "transfer_kept");
    expect(transfer.result).toBe("violated");
    for (const f of transfer.findings) {
      expect(f.said.length).toBeGreaterThan(0);
      for (const seq of f.said) {
        const item = failedSample.evidence.items.find((i) => i.seq === seq)!;
        expect(item).toMatchObject({ kind: "turn", role: "agent" });
      }
    }
  });
});

describe("vocabulary", () => {
  it("has one display label per result, verdict, note and contract (spec section 5 and 6.8)", () => {
    for (const r of RESULTS) expect(RESULT_LABEL[r]).toBeTruthy();
    for (const v of VERDICTS) expect(VERDICT_LABEL[v]).toBeTruthy();
    for (const n of NOTES) expect(NOTE_LINE[n]).toBeTruthy();
    for (const c of CONTRACT_IDS) expect(CONTRACT_TITLE[c]).toBeTruthy();
    expect(RESULT_LABEL.unverified).toBe("Couldn't check");
    expect(RESULT_LABEL.not_applicable).toBe("Doesn't apply");
    expect(RESULT_LABEL.not_run).toBe("Not checked");
    expect(GAP_CODES).toHaveLength(8);
  });

  it("writes the headline from the verdict, notes and reasons, word for word", () => {
    expect(headlineFor("failed", [], [])).toBe("The call broke a rule, and the call record shows it.");
    expect(headlineFor("passed", [], [])).toBe("Every promise that applied was kept.");
    expect(headlineFor("passed", ["no_promises_made"], [])).toBe("Passed. The agent made no promises.");
    expect(headlineFor("passed", ["request_not_checked"], [])).toBe(
      "Every promise that applied was kept. The caller's request wasn't checked.",
    );
    expect(headlineFor("passed", ["no_promises_made", "request_not_checked"], [])).toBe(
      "Passed. The agent made no promises. The caller's request wasn't checked.",
    );
    expect(headlineFor("needs_review", [], [{ kind: "deferral" }])).toBe(
      "The agent deferred the caller's request instead of completing it.",
    );
  });

  it("writes the Nothing done verdict and its headline word for word", () => {
    expect(VERDICTS).toEqual(["failed", "needs_review", "passed", "nothing_done"]);
    expect(VERDICT_LABEL.nothing_done).toBe("Nothing done");
    expect(headlineFor("nothing_done", [], [])).toBe("Nothing done. The caller said almost nothing, and the agent took no action.");
  });

  it("names the three experience checks", () => {
    expect(EXPERIENCE_CHECKS).toEqual(["agent_ends_call", "error_handled", "spoken_format"]);
    expect(EXPERIENCE_TITLE).toEqual({
      agent_ends_call: "the agent ends the call",
      error_handled: "errors handled well",
      spoken_format: "dates and times read naturally",
    });
  });

  it("uses no em or en dashes in any wording", () => {
    const all = [
      ...Object.values(RESULT_LABEL),
      ...Object.values(VERDICT_LABEL),
      ...Object.values(NOTE_LINE),
      ...Object.values(CONTRACT_TITLE),
      ...Object.values(EXPERIENCE_TITLE),
      headlineFor("nothing_done", [], []),
    ];
    for (const s of all) expect(s).not.toMatch(/[–—]/);
    for (const r of SAMPLE_REPORTS) expect(JSON.stringify(r)).not.toMatch(/[–—]/);
  });
});

describe("the contract the dashboard can rely on", () => {
  it("rejects fields the schema does not know, so drift is loud", () => {
    const r = clone(passedSample) as Record<string, unknown>;
    r.surprise = true;
    expect(issues(r).join("\n")).toMatch(/surprise|Unrecognized/i);
  });

  it("rejects a report with no schemaVersion or a different one", () => {
    const r = clone(passedSample) as Record<string, unknown>;
    r.schemaVersion = 2;
    expect(issues(r).length).toBeGreaterThan(0);
  });

  it("rejects a verdict that its results do not support", () => {
    const r = clone(failedSample);
    r.verdict = "passed";
    r.headline = headlineFor("passed", [], []);
    expect(issues(r).join("\n")).toMatch(/verdict/);
  });

  it("rejects failed when no contract is violated", () => {
    const r = clone(passedSample);
    r.verdict = "failed";
    r.notes = [];
    r.headline = headlineFor("failed", [], []);
    expect(issues(r).join("\n")).toMatch(/verdict/);
  });

  it("rejects a contract result that is not the worst of its findings", () => {
    const r = clone(failedSample);
    const t = result(r, "transfer_kept");
    t.result = "unverified";
    expect(issues(r).join("\n")).toMatch(/worst/);
  });

  it("rejects a headline that is not the one the wording table gives", () => {
    const r = clone(passedSample);
    r.headline = "All good!";
    expect(issues(r).join("\n")).toMatch(/headline/);
  });

  it("rejects a seq that is not in the evidence", () => {
    const r = clone(failedSample);
    result(r, "transfer_kept").findings[0].did = [9999];
    expect(issues(r).join("\n")).toMatch(/9999/);
  });

  it("rejects a said seq that is not an agent turn", () => {
    const r = clone(failedSample);
    const callerTurn = r.evidence.items.find((i) => i.kind === "turn" && i.role === "caller")!;
    result(r, "transfer_kept").findings[0].said = [callerTurn.seq];
    expect(issues(r).join("\n")).toMatch(/said/);
  });

  it("rejects notes on a call that did not pass", () => {
    const r = clone(failedSample);
    r.notes = ["request_not_checked"];
    expect(issues(r).join("\n")).toMatch(/notes/);
  });

  it("rejects request_not_checked when the request contract ran", () => {
    const r = clone(passedSample);
    result(r, "committed_matches_request").result = "not_applicable";
    expect(issues(r).join("\n")).toMatch(/request_not_checked/);
  });

  it("rejects needs_review with no reason, and an unverified result with no reason", () => {
    const r = clone(needsReviewSample);
    r.reasons = [];
    expect(issues(r).join("\n")).toMatch(/reasons/);
  });

  it("rejects a seq list that is not 1, 2, 3 in order", () => {
    const r = clone(passedSample);
    r.evidence.items[3].seq = 99;
    expect(issues(r).join("\n")).toMatch(/seq/);
  });

  it("rejects a tool result whose id matches no tool call", () => {
    const r = clone(passedSample);
    const res = r.evidence.items.find((i) => i.kind === "tool_result")!;
    (res as { id: string }).id = "nope";
    expect(issues(r).join("\n")).toMatch(/tool call/);
  });
});

describe("claimClass", () => {
  it("is exported and maps promise_backed and spoken_matches_committed to completion and transfer_kept to transfer", () => {
    expect(claimClass).toEqual({
      promise_backed: ["completion"],
      spoken_matches_committed: ["completion"],
      transfer_kept: ["transfer"],
    });
  });
});

describe("timezone must be a valid IANA zone", () => {
  it.each(["UTC", "America/New_York"])("accepts %s on the report and on the policy", (zone) => {
    const r = clone(passedSample);
    r.timezone = zone;
    r.policy.timezone = zone;
    expect(issues(r)).toEqual([]);
  });

  it.each(["Mars/Base", "", "+05:00"])("rejects %j on the report", (zone) => {
    const r = clone(passedSample);
    r.timezone = zone;
    expect(issues(r).join("\n")).toMatch(/^timezone: .*IANA/m);
  });

  it.each(["Mars/Base", "", "+05:00"])("rejects %j on the policy", (zone) => {
    const r = clone(passedSample);
    r.policy.timezone = zone;
    expect(issues(r).join("\n")).toMatch(/^policy\.timezone: .*IANA/m);
  });

  it("still lets the policy leave its timezone out", () => {
    const r = clone(passedSample);
    delete r.policy.timezone;
    expect(issues(r)).toEqual([]);
  });
});

describe("callStartMs must be a non-negative integer or null", () => {
  it.each([0, 1790205241776, null])("accepts %j", (ms) => {
    const r = clone(passedSample);
    r.evidence.callStartMs = ms;
    expect(issues(r)).toEqual([]);
  });

  it.each([-1, 1.5])("rejects %j", (ms) => {
    const r = clone(passedSample);
    r.evidence.callStartMs = ms;
    expect(issues(r).join("\n")).toMatch(/^evidence\.callStartMs: /m);
  });
});

describe("an LLM finding alone never produces violated", () => {
  /** The failed sample with both transfer claims found only by the model, and every other claim confirmed by both. */
  const llmOnlyTransfer = () => {
    const r = clone(failedSample);
    // The code detector missed the transfer claims; only the model found them.
    r.llmUsed = true;
    for (const d of r.detections) d.source = d.cls === "transfer" ? "llm" : "both";
    return r;
  };

  it("rejects a violated finding that cites a claim only the model found", () => {
    expect(issues(llmOnlyTransfer()).join("\n")).toMatch(/llm/i);
  });

  it("accepts the same claim as unverified, with the llm_code_disagreement gap named", () => {
    const r = llmOnlyTransfer();
    const t = result(r, "transfer_kept");
    t.result = "unverified";
    for (const f of t.findings) {
      f.result = "unverified";
      f.gaps = ["llm_code_disagreement"];
      f.text = "Couldn't check transfers kept: only the model found this claim. Run the code detector over the turn.";
    }
    r.evidence.gaps.push({ code: "llm_code_disagreement", detail: "The model found a transfer claim the code detector did not.", seqs: t.findings.flatMap((f) => f.said) });
    r.verdict = "needs_review";
    r.headline = headlineFor("needs_review", [], [{ kind: "unverified_result" }]);
    r.reasons = [{ kind: "unverified_result", contract: "transfer_kept", text: "Something couldn't be checked. See what's missing.", seqs: t.findings.flatMap((f) => f.said) }];
    expect(issues(r)).toEqual([]);
  });

  it("rejects an unverified finding on an llm-only claim that does not name the gap", () => {
    const r = llmOnlyTransfer();
    const t = result(r, "transfer_kept");
    t.result = "unverified";
    for (const f of t.findings) f.result = "unverified";
    r.verdict = "needs_review";
    r.headline = headlineFor("needs_review", [], [{ kind: "unverified_result" }]);
    r.reasons = [{ kind: "unverified_result", contract: "transfer_kept", text: "x", seqs: [] }];
    expect(issues(r).join("\n")).toMatch(/llm_code_disagreement/);
  });
});

describe("Tier 2: a backend action links to a tool call by id", () => {
  /** The passed sample as Tier 2: a backend action placed right after the booking call, linked by tool_call_id. */
  const withBackend = () => {
    const r = clone(passedSample);
    r.evidence.tier = 2;
    const book = r.evidence.items.find((i) => i.kind === "tool_call" && i.name === "book_appointment")!;
    const at = r.evidence.items.findIndex((i) => i.seq === book.seq) + 1;
    r.evidence.items.splice(at, 0, {
      kind: "backend_action",
      seq: 0,
      id: "action_1",
      toolCallId: (book as { id: string }).id,
      tool: "book_appointment",
      args: (book as { args: Record<string, unknown> }).args,
      result: { ok: true },
      ok: true,
      ts: "2026-11-05T20:45:20.000Z",
      link: { toolCallId: (book as { id: string }).id, by: "tool_call_id" },
    });
    r.evidence.items.forEach((it, i) => (it.seq = i + 1));
    // Renumbering moves later seqs; remap what the report points at.
    const shift = (s: number) => (s > book.seq ? s + 1 : s);
    for (const res of r.results) for (const f of res.findings) { f.said = f.said.map(shift); f.did = f.did.map(shift); f.asked = f.asked.map(shift); }
    for (const d of r.detections) d.seq = shift(d.seq);
    return r;
  };

  it("validates a Tier 2 report whose backend action points at a real tool call", () => {
    expect(issues(withBackend())).toEqual([]);
  });

  it("rejects a link to a tool call id that does not exist", () => {
    const r = withBackend();
    const a = r.evidence.items.find((i) => i.kind === "backend_action") as { link: { toolCallId: string; by: "tool_call_id" | "name_and_args" } | null };
    a.link = { toolCallId: "missing", by: "tool_call_id" };
    expect(issues(r).join("\n")).toMatch(/link/);
  });

  it("rejects a backend action in a Tier 1 report", () => {
    const r = withBackend();
    r.evidence.tier = 1;
    expect(issues(r).join("\n")).toMatch(/tier/i);
  });

  it("accepts a Tier 2 report whose log held no actions for this call", () => {
    const r = clone(passedSample);
    r.evidence.tier = 2;
    expect(issues(r)).toEqual([]);
  });

  it("rejects a tool_call_id link that does not use the action's own toolCallId", () => {
    const r = withBackend();
    const a = r.evidence.items.find((i) => i.kind === "backend_action") as { toolCallId: string | null };
    a.toolCallId = "something-else";
    expect(issues(r).join("\n")).toMatch(/toolCallId/);
  });

  it("keeps the raw id of an action that matched nothing, with a gap saying so", () => {
    const r = withBackend();
    const a = r.evidence.items.find((i) => i.kind === "backend_action") as { toolCallId: string | null; link: unknown; seq: number };
    a.toolCallId = "id-retell-never-sent";
    a.link = null;
    expect(issues(r).join("\n")).toMatch(/unlinked/);
    r.evidence.gaps.push({ code: "unlinked_backend_action", detail: "A backend action matched no tool call.", seqs: [a.seq] });
    expect(issues(r)).toEqual([]);
  });
});

describe("unverified results and gaps", () => {
  it("accepts an unverified contract with a gap and a matching reason", () => {
    const r = clone(passedSample);
    const c = result(r, "spoken_matches_committed");
    const claim = c.findings[0].said[0];
    c.result = "unverified";
    c.findings = [
      {
        result: "unverified",
        text: "Couldn't check spoken details match the booking: the booked slot was not in any earlier availability result. Return the slot's time and provider from the booking tool.",
        said: [claim],
        did: c.findings[0].did,
        asked: [],
        gaps: ["unresolved_committed_detail"],
        fields: [{ field: "time", type: "time", from: "spoken", values: ["2:00 p.m."], committed: null, status: "unresolved" }],
      },
    ];
    r.evidence.gaps.push({ code: "unresolved_committed_detail", detail: "The booked slot was not in any availability result.", seqs: c.findings[0].did, field: "time" });
    r.notes = [];
    r.verdict = "needs_review";
    r.reasons = [{ kind: "unverified_result", contract: "spoken_matches_committed", text: "Something couldn't be checked. See what's missing.", seqs: c.findings[0].did }];
    r.headline = headlineFor("needs_review", [], r.reasons);
    expect(issues(r)).toEqual([]);
  });

  it("rejects a finding that names a gap the evidence does not list", () => {
    const r = clone(passedSample);
    result(r, "promise_backed").findings[0].gaps = ["ambiguous_link"];
    expect(issues(r).join("\n")).toMatch(/gap/);
  });
});

describe("a report cannot contradict itself", () => {
  it("rejects a passed finding with a field that differs", () => {
    const r = clone(passedSample);
    result(r, "spoken_matches_committed").findings[0].fields[0].status = "differs";
    expect(issues(r).join("\n")).toMatch(/differs/);
  });

  it("rejects violated with order unknown", () => {
    const r = clone(failedSample);
    r.evidence.ordering = "none";
    expect(issues(r).join("\n")).toMatch(/ordering none/);
  });

  it("rejects a violated finding that cites a gap", () => {
    const r = clone(failedSample);
    r.evidence.gaps.push({ code: "ambiguous_link", detail: "x", seqs: [] });
    result(r, "transfer_kept").findings[0].gaps = ["ambiguous_link"];
    expect(issues(r).join("\n")).toMatch(/gap/);
  });

  it("rejects a passed call that holds a deferral", () => {
    const r = clone(passedSample);
    const turn = r.evidence.items.find((i) => i.kind === "turn" && i.role === "agent")!;
    r.detections.push({ seq: turn.seq, cls: "deferral", quote: (turn as { text: string }).text.slice(0, 5), source: "code" });
    expect(issues(r).join("\n")).toMatch(/deferral/);
  });

  it("rejects a model detection when llmUsed is false", () => {
    const r = clone(failedSample);
    r.detections[0].source = "both";
    expect(issues(r).join("\n")).toMatch(/llmUsed/);
  });

  it("with llmUsed, a claim only the code found cannot be violated", () => {
    const r = clone(failedSample);
    r.llmUsed = true;
    expect(issues(r).join("\n")).toMatch(/only (the code|one detector)/);
  });

  it("rejects an empty quote", () => {
    const r = clone(failedSample);
    r.detections[0].quote = "";
    expect(issues(r).length).toBeGreaterThan(0);
  });
});

describe("provenance is judged per cited claim", () => {
  const mixed = () => {
    const r = clone(failedSample);
    r.llmUsed = true;
    for (const d of r.detections) d.source = d.cls === "transfer" && d.seq === 27 ? "llm" : "both";
    return r;
  };

  it("rejects the finding on the model-only claim while the corroborated one stays violated", () => {
    const r = mixed();
    const msgs = issues(r);
    expect(msgs.filter((m) => /only the llm found/.test(m))).toHaveLength(1);
    expect(msgs.join("\n")).toMatch(/findings\.1\.result/);
    expect(msgs.join("\n")).not.toMatch(/findings\.0\.result/);
  });

  it("rejects one finding that cites a corroborated and a model-only claim as violated", () => {
    const r = mixed();
    const t = result(r, "transfer_kept");
    t.findings = [{ ...t.findings[0], said: [25, 27] }];
    expect(issues(r).join("\n")).toMatch(/only the llm found/);
  });

  it("accepts a violated transfer built on spoken tool syntax, which only code can find", () => {
    const r = clone(failedSample);
    r.llmUsed = true;
    for (const d of r.detections) d.source = "both";
    for (const d of r.detections) if (d.cls === "transfer") d.cls = "tool_syntax";
    expect(issues(r)).toEqual([]);
  });

  it("rejects a violated transfer that cites a turn with no detected claim", () => {
    const r = clone(failedSample);
    r.detections = r.detections.filter((d) => d.cls !== "transfer");
    expect(issues(r).join("\n")).toMatch(/matching claim|not_applicable|transfer_kept/);
  });

  it("rejects not_applicable transfers while a transfer claim stands", () => {
    const r = clone(failedSample);
    const t = result(r, "transfer_kept");
    t.result = "not_applicable";
    t.findings = [];
    expect(issues(r).join("\n")).toMatch(/not_applicable only when no transfer/);
  });
});

describe("evidence that would make a violation unsafe", () => {
  it("rejects violated when a gap touches the finding's evidence, even if the finding does not list it", () => {
    const r = clone(failedSample);
    const f = result(r, "transfer_kept").findings[0];
    r.evidence.gaps.push({ code: "evidence_conflict", detail: "The backend log and the platform record disagree.", seqs: [f.said[0]] });
    expect(issues(r).join("\n")).toMatch(/gap touches/);
  });

  it("does not let an unrelated gap block a violation", () => {
    const r = clone(failedSample);
    r.evidence.gaps.push({ code: "unknown_success", detail: "A caller turn had no success signal.", seqs: [2] });
    expect(issues(r)).toEqual([]);
  });

  it("rejects a passed finding that cites the unknown_success gap", () => {
    const r = clone(passedSample);
    r.evidence.gaps.push({ code: "unknown_success", detail: "The booking result had no success signal.", seqs: [33] });
    result(r, "promise_backed").findings[0].gaps = ["unknown_success"];
    expect(issues(r).join("\n")).toMatch(/passed finding cannot cite a gap/);
  });

  it("rejects a passed finding when a gap touches its evidence, even if it does not list it", () => {
    const r = clone(passedSample);
    r.evidence.gaps.push({ code: "unknown_success", detail: "The booking result had no success signal.", seqs: [33] });
    expect(issues(r).join("\n")).toMatch(/never passed/);
  });

  it("does not let an unrelated gap block a pass", () => {
    const r = clone(passedSample);
    r.evidence.gaps.push({ code: "unknown_success", detail: "A lookup had no success signal.", seqs: [13] });
    expect(issues(r)).toEqual([]);
  });

  it("rejects a field with no committed value that claims to match", () => {
    const r = clone(passedSample);
    const field = result(r, "spoken_matches_committed").findings[0].fields[0];
    field.committed = null;
    expect(issues(r).join("\n")).toMatch(/cannot match/);
  });

  it("rejects a call field the report does not carry, such as a recording link", () => {
    const r = clone(passedSample) as unknown as { evidence: { callFields: Record<string, unknown> } };
    r.evidence.callFields.recording_url = "x";
    expect(issues(r).join("\n")).toMatch(/recording_url|Unrecognized/);
  });

  it("accepts a name_and_args link only when exactly one tool call has that tool and those args", () => {
    const r = clone(passedSample);
    r.evidence.tier = 2;
    const book = r.evidence.items.find((i) => i.kind === "tool_call" && i.name === "book_appointment") as { id: string; args: Record<string, unknown> };
    r.evidence.items.push({ kind: "backend_action", seq: r.evidence.items.length + 1, id: "a1", toolCallId: null, tool: "book_appointment", args: { ...book.args }, result: { ok: true }, ok: true, ts: "2026-11-05T20:45:20.000Z", link: { toolCallId: book.id, by: "name_and_args" } });
    expect(issues(r)).toEqual([]);
    const second = { ...book, seq: r.evidence.items.length + 1, id: "dup" };
    r.evidence.items.push(second as (typeof r.evidence.items)[number]);
    expect(issues(r).join("\n")).toMatch(/exactly one tool call/);
  });
});

describe("the engine and the dashboard share this folder", () => {
  it("uses no Node API in the schema, labels or samples index, so a browser can load them", () => {
    for (const file of ["schema.ts", "labels.ts", "samples/index.ts"]) {
      const src = fs.readFileSync(path.join(__dirname, file), "utf8");
      expect(src).not.toMatch(/["']node:|\bprocess\b|\brequire\(|\bBuffer\b|from ["'](fs|path|os|crypto)["']/);
    }
  });
});

/** A valid nothing_done report: the passed sample with every promise taken out, so nothing applied. */
function nothingDone(): CallReport {
  const r = clone(passedSample);
  r.verdict = "nothing_done";
  r.notes = [];
  r.headline = headlineFor("nothing_done", [], []);
  r.detections = [];
  for (const c of r.results) {
    if (c.result !== "not_run") {
      c.result = "not_applicable";
      c.findings = [];
    }
  }
  return r;
}
const agentSeq = (r: CallReport) => r.evidence.items.find((i) => i.kind === "turn" && i.role === "agent")!.seq;
const callerSeq = (r: CallReport) => r.evidence.items.find((i) => i.kind === "turn" && i.role === "caller")!.seq;

describe("the Nothing done verdict", () => {
  it("parses when no contract applied and there are no reasons or notes", () => {
    expect(issues(nothingDone())).toEqual([]);
  });

  it("is rejected when a contract is violated", () => {
    const r = clone(failedSample);
    r.verdict = "nothing_done";
    r.headline = headlineFor("nothing_done", [], []);
    expect(issues(r).join("\n")).toMatch(/verdict/);
  });

  it("is rejected when a contract is unverified", () => {
    const r = nothingDone();
    const c = result(r, "promise_backed");
    c.result = "unverified";
    c.findings = [{ result: "unverified", text: "x", said: [agentSeq(r)], did: [], asked: [], gaps: [], fields: [] }];
    expect(issues(r).join("\n")).toMatch(/verdict is nothing_done but the results give needs_review/);
  });

  it("is rejected with notes", () => {
    const r = nothingDone();
    r.notes = ["request_not_checked"];
    expect(issues(r).join("\n")).toMatch(/notes/);
  });

  it("is rejected with reasons", () => {
    const r = nothingDone();
    r.reasons = [{ kind: "deferral", text: "x", seqs: [agentSeq(r)] }];
    expect(issues(r).join("\n")).toMatch(/reasons/);
  });

  it("is rejected when a contract that ran passed", () => {
    const r = nothingDone();
    const turn = agentSeq(r);
    result(r, "promise_backed").result = "passed";
    result(r, "promise_backed").findings = [{ result: "passed", text: "x", said: [turn], did: [], asked: [], gaps: [], fields: [] }];
    expect(issues(r).join("\n")).toMatch(/nothing_done/);
  });

  it("is rejected when a deferral was detected", () => {
    const r = nothingDone();
    const turn = r.evidence.items.find((i) => i.kind === "turn" && i.role === "agent")! as { seq: number; text: string };
    r.detections.push({ seq: turn.seq, cls: "deferral", quote: turn.text.slice(0, 5), source: "code" });
    expect(issues(r).join("\n")).toMatch(/deferral/);
  });

  it("is rejected with a headline other than its own line", () => {
    const r = nothingDone();
    r.headline = headlineFor("passed", [], []);
    expect(issues(r).join("\n")).toMatch(/headline/);
  });
});

describe("the call experience field", () => {
  it("gets the default when a report stored before this change has no experience", () => {
    const older: Record<string, unknown> = clone(passedSample);
    delete older.experience;
    const parsed = CallReportSchema.parse(older);
    expect(parsed.experience).toEqual({ ran: [], problems: [] });
    expect(parsed.schemaVersion).toBe(1);
  });

  it("gives each old report its own default arrays, so mutating one does not touch another", () => {
    const older = (): Record<string, unknown> => {
      const o: Record<string, unknown> = clone(passedSample);
      delete o.experience;
      return o;
    };
    const a = CallReportSchema.parse(older());
    const b = CallReportSchema.parse(older());
    expect(a.experience.ran).not.toBe(b.experience.ran);
    expect(a.experience.problems).not.toBe(b.experience.problems);
    a.experience.ran.push("error_handled");
    expect(b.experience.ran).toEqual([]);
  });

  it("accepts a problem whose check ran and whose seq is an agent turn", () => {
    const r = clone(passedSample);
    r.experience = { ran: ["agent_ends_call"], problems: [{ check: "agent_ends_call", text: "x", seqs: [agentSeq(r)] }] };
    expect(issues(r)).toEqual([]);
  });

  it("rejects a problem whose check is not in ran", () => {
    const r = clone(passedSample);
    r.experience = { ran: ["error_handled"], problems: [{ check: "agent_ends_call", text: "x", seqs: [agentSeq(r)] }] };
    expect(issues(r).join("\n")).toMatch(/experience/);
  });

  it("rejects a repeat in ran", () => {
    const r = clone(passedSample);
    r.experience = { ran: ["error_handled", "error_handled"], problems: [] };
    expect(issues(r).join("\n")).toMatch(/experience/);
  });

  it("rejects a problem seq on a caller turn", () => {
    const r = clone(passedSample);
    r.experience = { ran: ["agent_ends_call"], problems: [{ check: "agent_ends_call", text: "x", seqs: [callerSeq(r)] }] };
    expect(issues(r).join("\n")).toMatch(/agent turn/);
  });

  it("rejects a problem seq that is not in the evidence", () => {
    const r = clone(passedSample);
    r.experience = { ran: ["agent_ends_call"], problems: [{ check: "agent_ends_call", text: "x", seqs: [9999] }] };
    expect(issues(r).join("\n")).toMatch(/not in the evidence/);
  });

  it("rejects a problem with no seqs or no text", () => {
    const r = clone(passedSample);
    r.experience = { ran: ["agent_ends_call"], problems: [{ check: "agent_ends_call", text: "", seqs: [] }] };
    expect(issues(r).length).toBeGreaterThan(0);
  });

  it("rejects a key the field does not know", () => {
    const r = { ...clone(passedSample), experience: { ran: [], problems: [], extra: 1 } };
    expect(issues(r).length).toBeGreaterThan(0);
  });

  it("is on every sample, empty", () => {
    for (const report of SAMPLE_REPORTS) expect(report.experience).toEqual({ ran: [], problems: [] });
    for (const file of ["failed.json", "needs-review.json", "passed.json"]) {
      const onDisk = JSON.parse(fs.readFileSync(path.join(__dirname, "samples", file), "utf8"));
      expect(onDisk.experience).toEqual({ ran: [], problems: [] });
    }
  });
});
