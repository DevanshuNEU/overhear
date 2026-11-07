// The call report: what the Overhear engine produces for one call and the dashboard reads.
// This file is the contract between them. Types are inferred from the schema, so a sample
// that validates here is a value both sides can use. Vocabulary follows spec section 5 and
// evidence follows 6.1. No Node APIs: a browser loads this file too.
import { z } from "zod";
import { headlineFor } from "./labels";

export const SCHEMA_VERSION = 1;

export const PLATFORMS = ["retell", "livekit"] as const;
export const CHANGE_KINDS = ["book", "cancel", "reschedule", "update"] as const;
export const ROLES = ["verify", "lookup", "change", "transfer"] as const;
export const FIELD_TYPES = ["date", "time", "datetime", "name", "string", "number", "money", "id"] as const;
export const GAP_CODES = [
  "missing_tool_transcript",
  "unlinked_backend_action",
  "ambiguous_link",
  "turn_index_out_of_range",
  "unknown_success",
  "evidence_conflict",
  "unresolved_committed_detail",
  "llm_code_disagreement",
] as const;
export const RESULTS = ["violated", "passed", "unverified", "not_applicable", "not_run"] as const;
export const VERDICTS = ["failed", "needs_review", "passed"] as const;
export const NOTES = ["no_promises_made", "request_not_checked"] as const;
export const CONTRACT_IDS = [
  "promise_backed",
  "verified_before_change",
  "spoken_matches_committed",
  "transfer_kept",
  "committed_matches_request",
] as const;
// tool_syntax is an agent turn that reads a tool call out loud (6.4). Code finds it by rule, so it needs no second detector.
export const SPEECH_CLASSES = ["completion", "transfer", "intention", "offer", "deferral", "refusal", "tool_syntax"] as const;
export const REVIEW_REASON_KINDS = ["unverified_result", "deferral", "unanswered_request"] as const;

export type Platform = (typeof PLATFORMS)[number];
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export type GapCode = (typeof GAP_CODES)[number];
export type Result = (typeof RESULTS)[number];
export type Verdict = (typeof VERDICTS)[number];
export type Note = (typeof NOTES)[number];
export type ContractId = (typeof CONTRACT_IDS)[number];
export type ReviewReasonKind = (typeof REVIEW_REASON_KINDS)[number];
export type SpeechClass = (typeof SPEECH_CLASSES)[number];

// The speech class a contract's claim is made of. A finding's provenance (code, llm or both) is judged on the
// detections of this class at its cited turns. The screen reads it too, to mark the words a verdict rests on.
export const claimClass: Readonly<Partial<Record<ContractId, readonly SpeechClass[]>>> = {
  promise_backed: ["completion"],
  spoken_matches_committed: ["completion"],
  transfer_kept: ["transfer"],
};

// Gaps about the evidence itself. One that touches a finding's seqs makes the finding unverified. The other two
// (unresolved_committed_detail, llm_code_disagreement) belong to one contract and are cited through Finding.gaps.
const EVIDENCE_GAPS = new Set<string>([
  "missing_tool_transcript",
  "unlinked_backend_action",
  "ambiguous_link",
  "turn_index_out_of_range",
  "unknown_success",
  "evidence_conflict",
]);

const Seq = z.number().int().positive();

/** True for a time zone Intl knows by name. Offsets such as "+05:00" are not IANA zones, and some runtimes accept them. */
function isTimeZone(zone: string): boolean {
  if (zone === "" || /^[+-]/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
const TimeZone = z.string().refine(isTimeZone, { message: "must be an IANA time zone, such as UTC or America/New_York" });
const Args = z.record(z.string(), z.unknown());

/** Equal by content: object key order is ignored, array order is not. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    const keys = Object.keys(x);
    return keys.length === Object.keys(y).length && keys.every((k) => k in y && sameValue(x[k], y[k]));
  }
  return false;
}

// ---------- Evidence (6.1) ----------

export const GapSchema = z.strictObject({
  code: z.enum(GAP_CODES),
  detail: z.string(),
  seqs: z.array(Seq),
  tool: z.string().optional(),
  field: z.string().optional(),
  kind: z.enum(CHANGE_KINDS).optional(),
});

export const ItemSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("turn"),
    seq: Seq,
    role: z.enum(["agent", "caller"]),
    text: z.string(),
    startSec: z.number().nullable(),
    interrupted: z.boolean().nullable(),
  }),
  z.strictObject({ kind: z.literal("tool_call"), seq: Seq, id: z.string(), name: z.string(), args: Args }),
  z.strictObject({
    kind: z.literal("tool_result"),
    seq: Seq,
    id: z.string(),
    // The success the engine settled on (6.1): the policy's payload path, then the backend action, then platformOk.
    ok: z.boolean().nullable(),
    // The platform's own success field (Retell `successful`, LiveKit `!is_error`).
    platformOk: z.boolean().nullable(),
    payload: z.unknown(),
  }),
  z.strictObject({ kind: z.literal("event"), seq: Seq, type: z.string(), data: z.unknown() }),
  z.strictObject({
    kind: z.literal("backend_action"),
    seq: Seq,
    id: z.string().nullable(),
    // The tool_call_id the backend logged, as received. Kept even when it matched nothing (link is then null).
    toolCallId: z.string().nullable(),
    tool: z.string(),
    args: Args,
    result: z.unknown(),
    ok: z.boolean(),
    ts: z.string(),
    // Which tool call this action is, and how we know. `tool_call_id` is exact (Retell sends it on every
    // tool request); `name_and_args` is the fallback when an id is missing.
    link: z.strictObject({ toolCallId: z.string(), by: z.enum(["tool_call_id", "name_and_args"]) }).nullable(),
  }),
]);

export const CallFieldsSchema = z.strictObject({
  call_type: z.string().optional(),
  disconnection_reason: z.string().optional(),
  duration_ms: z.number().optional(),
  call_analysis: z
    .strictObject({
      call_successful: z.boolean().optional(),
      call_summary: z.string().optional(),
      user_sentiment: z.string().optional(),
      in_voicemail: z.boolean().optional(),
      custom_analysis_data: Args.optional(),
    })
    .optional(),
});

export const EvidenceSchema = z.strictObject({
  callId: z.string(),
  platform: z.enum(PLATFORMS),
  agentVersion: z.string().nullable(),
  tier: z.union([z.literal(1), z.literal(2)]),
  ordering: z.enum(["sequence", "timestamps", "none"]),
  // Call-level fields worth showing. A short list on purpose: recording and log links, tokens and network
  // details never belong in a report. Fields for other platforms are added here when their adapters land.
  callFields: CallFieldsSchema,
  callStartMs: z.number().int().nonnegative().nullable(), // epoch milliseconds
  items: z.array(ItemSchema),
  gaps: z.array(GapSchema),
});

// ---------- Policy (6.5) ----------

export const ToolPolicySchema = z.strictObject({
  role: z.enum(ROLES),
  kind: z.enum(CHANGE_KINDS).optional(),
  success: z.string().optional(),
  id: z.string().optional(),
  patientId: z.string().optional(),
  items: z.string().optional(),
  required: z.array(z.string()).optional(),
});

export const FieldPolicySchema = z.strictObject({
  path: z.string(),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
});

export const PolicySchema = z.strictObject({
  packs: z.array(z.enum(["scheduling", "healthcare"])),
  timezone: TimeZone.optional(),
  success: z.string().optional(),
  tools: z.record(z.string(), ToolPolicySchema),
  fields: z.record(z.string(), FieldPolicySchema),
  request: z.strictObject({ kind: z.string().optional(), fields: z.record(z.string(), z.string()) }).optional(),
});

// ---------- Detections and the caller's request (6.4) ----------

export const DetectionSchema = z.strictObject({
  seq: Seq, // an agent turn
  cls: z.enum(SPEECH_CLASSES),
  kind: z.enum(CHANGE_KINDS).optional(),
  quote: z.string().min(1), // exact words, a substring of the turn
  source: z.enum(["code", "llm", "both"]),
});

export const CallerRequestSchema = z.strictObject({
  kind: z.enum([...CHANGE_KINDS, "transfer"]).optional(),
  fields: z.record(z.string(), z.string()),
  // The seq of the caller turn the quote came from; 0 for post-call analysis (the start of the call).
  position: z.number().int().nonnegative(),
  quote: z.string().optional(),
  source: z.enum(["post_call", "llm"]),
});

// ---------- Results ----------

// One compared value: what was spoken (or requested) next to what the system committed.
export const FieldCheckSchema = z.strictObject({
  field: z.string(),
  type: z.enum(FIELD_TYPES),
  from: z.enum(["spoken", "requested"]),
  values: z.array(z.string()), // as spoken or requested, in display form
  committed: z.string().nullable(), // null when it could not be resolved; when unresolved for a time zone doubt, it names the candidate readings
  status: z.enum(["match", "differs", "not_spoken", "unresolved"]),
}).refine((f) => !(f.committed === null && f.status === "match"), {
  path: ["status"],
  message: "a field with no committed value cannot match",
});

export const FindingSchema = z.strictObject({
  result: z.enum(["violated", "unverified", "passed"]),
  text: z.string(), // wording from spec 6.8, filled in by code
  // The rows of the "said | did" view. Each list is seqs into evidence.items.
  said: z.array(Seq), // agent turns: the words that made the claim
  did: z.array(Seq), // tool calls, results, backend actions, events: what the system did
  asked: z.array(Seq), // caller turns: the request the call is compared with
  gaps: z.array(z.enum(GAP_CODES)),
  fields: z.array(FieldCheckSchema),
});

export const ContractResultSchema = z.strictObject({
  contract: z.enum(CONTRACT_IDS),
  result: z.enum(RESULTS),
  findings: z.array(FindingSchema),
});

// Why a call needs review, beyond what a contract result says (6.6).
export const ReviewReasonSchema = z.strictObject({
  kind: z.enum(REVIEW_REASON_KINDS),
  contract: z.enum(CONTRACT_IDS).optional(), // set for unverified_result
  text: z.string(),
  seqs: z.array(Seq),
});

// ---------- The report ----------

export const CallReportSchema = z
  .strictObject({
    schemaVersion: z.literal(SCHEMA_VERSION),
    callId: z.string(),
    platform: z.enum(PLATFORMS),
    verdict: z.enum(VERDICTS),
    notes: z.array(z.enum(NOTES)),
    headline: z.string(),
    reasons: z.array(ReviewReasonSchema),
    results: z.array(ContractResultSchema),
    detections: z.array(DetectionSchema),
    // Whether a model helped find claims or the request. With it, a claim only the code found is unverified (6.4).
    llmUsed: z.boolean(),
    request: CallerRequestSchema.nullable(),
    requestSource: z.enum(["post_call", "llm"]).nullable(),
    timezone: TimeZone,
    policy: PolicySchema,
    evidence: EvidenceSchema,
  })
  .superRefine((r, ctx) => {
    /** Records one validation problem at a path. */
    const bad = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const items = r.evidence.items;

    // Evidence: seq is 1, 2, 3 in order; tool results and backend actions point at real tool calls; Tier matches.
    items.forEach((it, i) => {
      if (it.seq !== i + 1) bad(["evidence", "items", i, "seq"], `seq must be ${i + 1}, the item's position in the timeline`);
    });
    const bySeq = new Map(items.map((it) => [it.seq, it]));
    const toolCallIds = new Set(items.flatMap((it) => (it.kind === "tool_call" ? [it.id] : [])));
    items.forEach((it, i) => {
      if (it.kind === "tool_result" && !toolCallIds.has(it.id)) bad(["evidence", "items", i, "id"], `tool result ${it.id} matches no tool call`);
      if (it.kind === "backend_action") {
        if (it.link && !toolCallIds.has(it.link.toolCallId)) {
          bad(["evidence", "items", i, "link"], `link points at tool call ${it.link.toolCallId}, which is not in the evidence`);
        }
        if (it.link?.by === "tool_call_id" && it.link.toolCallId !== it.toolCallId) {
          bad(["evidence", "items", i, "link"], "a link made by tool_call_id must use the action's own toolCallId");
        }
        if (it.link?.by === "name_and_args") {
          const matches = items.filter((x) => x.kind === "tool_call" && x.name === it.tool && sameValue(x.args, it.args));
          if (matches.length !== 1 || (matches[0] as { id: string }).id !== it.link.toolCallId) {
            bad(["evidence", "items", i, "link"], "a name_and_args link needs exactly one tool call with this tool and these args; otherwise leave it unlinked with an ambiguous_link gap");
          }
        }
        if (!it.link && !r.evidence.gaps.some((g) => g.seqs.includes(it.seq) && ["unlinked_backend_action", "ambiguous_link", "turn_index_out_of_range"].includes(g.code))) {
          bad(["evidence", "items", i, "link"], "an unlinked backend action needs an unlinked_backend_action, ambiguous_link or turn_index_out_of_range gap at its seq");
        }
      }
    });
    const hasBackend = items.some((it) => it.kind === "backend_action");
    if (r.evidence.tier === 1 && hasBackend) bad(["evidence", "tier"], "tier 1 evidence has no backend actions");
    if (r.callId !== r.evidence.callId) bad(["callId"], "callId must equal evidence.callId");
    if (r.platform !== r.evidence.platform) bad(["platform"], "platform must equal evidence.platform");

    /** Checks that a seq names an item in the evidence. */
    const exists = (path: (string | number)[], seq: number) => {
      if (!bySeq.has(seq)) bad(path, `seq ${seq} is not in the evidence`);
    };
    const gapCodes = new Set(r.evidence.gaps.map((g) => g.code));
    r.evidence.gaps.forEach((g, gi) => g.seqs.forEach((s, si) => exists(["evidence", "gaps", gi, "seqs", si], s)));

    // Detections are agent turns, and an LLM claim carries an exact quote.
    r.detections.forEach((d, i) => {
      exists(["detections", i, "seq"], d.seq);
      const it = bySeq.get(d.seq);
      if (it && !(it.kind === "turn" && it.role === "agent")) bad(["detections", i, "seq"], `detection at seq ${d.seq} must be an agent turn`);
      if (it && it.kind === "turn" && !it.text.includes(d.quote)) bad(["detections", i, "quote"], "quote must be an exact substring of the turn");
    });

    if (!r.llmUsed) {
      r.detections.forEach((d, i) => {
        if (d.source !== "code") bad(["detections", i, "source"], "with llmUsed false every detection comes from code");
      });
    }
    const deferred = r.detections.some((d) => d.cls === "deferral");

    // The caller's request.
    if (r.request?.source === "llm" && !r.llmUsed) bad(["llmUsed"], "an llm request means llmUsed is true");
    if (r.requestSource === null && r.request !== null) bad(["request"], "a request needs a request source");
    if (r.request) {
      if (r.request.source !== r.requestSource) bad(["request", "source"], "request.source must equal requestSource");
      if (r.request.source === "llm") {
        const turn = bySeq.get(r.request.position);
        if (!turn || turn.kind !== "turn" || turn.role !== "caller") bad(["request", "position"], "an llm request points at a caller turn");
        else if (!r.request.quote || !turn.text.includes(r.request.quote)) bad(["request", "quote"], "an llm request needs a quote that is an exact substring of that caller turn");
      } else if (r.request.position !== 0) bad(["request", "position"], "a post-call request starts at position 0");
    }

    // Contracts: the right set for the packs, and each result is the worst of its findings.
    const packs = r.policy.packs;
    const expected: ContractId[] = ["promise_backed", "spoken_matches_committed", "transfer_kept", "committed_matches_request"];
    if (packs.includes("healthcare")) expected.push("verified_before_change");
    const got = r.results.map((x) => x.contract);
    if (new Set(got).size !== got.length || got.length !== expected.length || !expected.every((c) => got.includes(c))) {
      bad(["results"], `results must hold exactly these contracts once each: ${expected.join(", ")}`);
    }

    const rank: Record<string, number> = { violated: 3, unverified: 2, passed: 1, not_applicable: 0 };

    r.results.forEach((c, ci) => {
      const at = ["results", ci] as (string | number)[];
      if (c.result === "not_run") {
        if (c.contract !== "committed_matches_request") bad([...at, "result"], "only committed_matches_request can be not_run");
        if (c.findings.length) bad([...at, "findings"], "a not_run contract has no findings");
      } else if (c.findings.length === 0) {
        if (c.result !== "not_applicable") bad([...at, "result"], `a ${c.result} result needs at least one finding`);
        if (c.contract === "transfer_kept" && r.detections.some((d) => d.cls === "transfer" || d.cls === "tool_syntax")) {
          bad([...at, "result"], "transfer_kept is not_applicable only when no transfer claim or spoken tool syntax was detected");
        }
      } else {
        const worst = c.findings.reduce((w, f) => (rank[f.result] > rank[w] ? f.result : w), "not_applicable" as string);
        if (c.result !== worst) bad([...at, "result"], `result is ${c.result} but the worst finding is ${worst}`);
      }
      if (c.contract === "committed_matches_request") {
        if (r.requestSource === null && c.result !== "not_run") bad([...at, "result"], "with no request source this contract is not_run");
        if (r.requestSource !== null && c.result === "not_run") bad([...at, "result"], "with a request source this contract runs");
      }

      c.findings.forEach((f, fi) => {
        const fat = [...at, "findings", fi] as (string | number)[];
        f.said.forEach((s, i) => {
          exists([...fat, "said", i], s);
          const it = bySeq.get(s);
          if (it && !(it.kind === "turn" && it.role === "agent")) bad([...fat, "said", i], `said seq ${s} must be an agent turn`);
        });
        f.asked.forEach((s, i) => {
          exists([...fat, "asked", i], s);
          const it = bySeq.get(s);
          if (it && !(it.kind === "turn" && it.role === "caller")) bad([...fat, "asked", i], `asked seq ${s} must be a caller turn`);
        });
        f.did.forEach((s, i) => {
          exists([...fat, "did", i], s);
          const it = bySeq.get(s);
          if (it && it.kind === "turn") bad([...fat, "did", i], `did seq ${s} is a turn; what the system did is a tool call, result, backend action or event`);
        });
        f.gaps.forEach((g, i) => {
          if (!gapCodes.has(g)) bad([...fat, "gaps", i], `gap ${g} is not listed in evidence.gaps`);
        });

        // A gap in a finding's evidence makes it unverified (6.4), so neither violated nor passed may rest on one.
        if (f.result !== "unverified") {
          if (f.gaps.length) bad([...fat, "gaps"], `a ${f.result} finding cannot cite a gap: a gap makes it unverified`);
          const touched = new Set([...f.said, ...f.did]);
          if (r.evidence.gaps.some((g) => EVIDENCE_GAPS.has(g.code) && g.seqs.some((sq) => touched.has(sq)))) {
            bad([...fat, "result"], `a gap touches this finding's evidence, so it is unverified, never ${f.result}`);
          }
        }
        // A violated finding rests on complete order, and on its own fields (6.4).
        if (f.result === "violated") {
          if (r.evidence.ordering === "none" && ["promise_backed", "verified_before_change", "transfer_kept"].includes(c.contract)) {
            bad([...fat, "result"], "with ordering none, a contract that depends on order is unverified, never violated");
          }
          if (f.fields.length && !f.fields.some((x) => x.status === "differs") && c.contract !== "transfer_kept") {
            bad([...fat, "fields"], "a violated finding with compared fields has at least one that differs");
          }
        }
        if (f.result === "passed" && f.fields.some((x) => x.status === "differs" || x.status === "unresolved")) {
          bad([...fat, "fields"], "a passed finding has no field that differs or is unresolved");
        }

        // An LLM finding alone never produces violated (6.4). Provenance is judged per cited claim.
        const classes = claimClass[c.contract];
        /** The detections of this contract's claim class at one agent turn. */
        const detectionsAt = (sq: number) => r.detections.filter((d) => d.seq === sq && classes?.includes(d.cls));
        const cited = classes ? f.said.filter((sq) => detectionsAt(sq).length > 0) : [];
        /** Which detectors found the claim at one turn. */
        const sourcesAt = (sq: number) => new Set(detectionsAt(sq).map((d) => d.source));
        // Corroborated: both detectors agree. llm-only: only the model. code-only: only the code, which matters once a model ran.
        const llmOnly = cited.filter((sq) => [...sourcesAt(sq)].every((x) => x === "llm"));
        const codeOnly = r.llmUsed ? cited.filter((sq) => [...sourcesAt(sq)].every((x) => x === "code")) : [];
        const uncorroborated = llmOnly.length + codeOnly.length > 0;
        if (llmOnly.length > 0 && f.result === "violated") bad([...fat, "result"], "a claim only the llm found cannot produce violated");
        if (codeOnly.length > 0 && f.result === "violated") bad([...fat, "result"], "with llmUsed, a claim only the code found cannot produce violated");
        if (uncorroborated && f.result !== "violated" && (f.result !== "unverified" || !f.gaps.includes("llm_code_disagreement"))) {
          bad([...fat, "gaps"], "a claim only one detector found must be unverified and name llm_code_disagreement");
        }
        // A violated claim-based finding names the claim it rests on.
        if (f.result === "violated" && classes && f.said.length > 0) {
          const matching = f.said.some((sq) => r.detections.some((d) => d.seq === sq && (classes.includes(d.cls) || (c.contract === "transfer_kept" && d.cls === "tool_syntax"))));
          if (!matching) bad([...fat, "said"], "a violated finding must cite an agent turn where a matching claim was detected");
        }
      });
    });

    // Verdict and what supports it (6.6).
    const anyViolated = r.results.some((c) => c.result === "violated");
    const unverified = r.results.filter((c) => c.result === "unverified");
    const expectedVerdict: Verdict = anyViolated ? "failed" : unverified.length > 0 || r.reasons.length > 0 ? "needs_review" : "passed";
    if (r.verdict !== expectedVerdict) bad(["verdict"], `verdict is ${r.verdict} but the results give ${expectedVerdict}`);

    r.reasons.forEach((reason, i) => {
      reason.seqs.forEach((s, si) => exists(["reasons", i, "seqs", si], s));
      if (reason.kind === "unverified_result") {
        if (!reason.contract || !unverified.some((c) => c.contract === reason.contract)) {
          bad(["reasons", i, "contract"], "an unverified_result reason names a contract whose result is unverified");
        }
      } else if (reason.contract) bad(["reasons", i, "contract"], "only unverified_result reasons name a contract");
    });
    if (r.verdict === "needs_review") {
      if (r.reasons.length === 0) bad(["reasons"], "a needs_review call must say why in reasons");
      for (const c of unverified) {
        if (!r.reasons.some((x) => x.kind === "unverified_result" && x.contract === c.contract)) {
          bad(["reasons"], `reasons must include an unverified_result for ${c.contract}`);
        }
      }
      if (deferred && !r.reasons.some((x) => x.kind === "deferral")) bad(["reasons"], "a deferral was detected, so reasons must include a deferral");
    } else if (r.reasons.length > 0) bad(["reasons"], "only a needs_review call has reasons");
    if (deferred && r.verdict === "passed") bad(["verdict"], "a call with a deferral is never passed");
    if (r.requestSource === null && r.reasons.some((x) => x.kind === "unanswered_request")) bad(["reasons"], "unanswered_request needs a request source");

    // Notes ride only on a passed call.
    if (r.verdict !== "passed") {
      if (r.notes.length) bad(["notes"], "notes ride only on a passed call");
    } else {
      const noPromises = r.results.filter((c) => c.result !== "not_run").every((c) => c.result === "not_applicable");
      const requestSkipped = r.results.some((c) => c.contract === "committed_matches_request" && c.result === "not_run");
      if (noPromises !== r.notes.includes("no_promises_made")) bad(["notes"], "no_promises_made is set exactly when every contract that ran was not_applicable");
      if (requestSkipped !== r.notes.includes("request_not_checked")) bad(["notes"], "request_not_checked is set exactly when committed_matches_request was not_run");
    }

    if (r.headline !== headlineFor(r.verdict, r.notes, r.reasons)) bad(["headline"], "headline must be the wording table's line for this verdict (spec 6.8)");
  });

export type Gap = z.infer<typeof GapSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type Detection = z.infer<typeof DetectionSchema>;
export type CallerRequest = z.infer<typeof CallerRequestSchema>;
export type FieldCheck = z.infer<typeof FieldCheckSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type ContractResult = z.infer<typeof ContractResultSchema>;
export type ReviewReason = z.infer<typeof ReviewReasonSchema>;
export type CallReport = z.infer<typeof CallReportSchema>;
