// Test helpers for the engine: build evidence by hand, derive what M1 should output for a sample, and check a
// report against the schema. Test-only, so it sits outside the purity guard.
import { CallReportSchema, type CallReport, type Evidence, type Item } from "@/report/schema";

/** An evidence item without its seq; ev() numbers them. */
export type ItemSpec = Item extends infer I ? (I extends Item ? Omit<I, "seq"> : never) : never;

/** Evidence for a test: items numbered 1..n in order, Tier 1, sequence ordering, no call fields and no gaps. */
export function ev(items: ItemSpec[], over: Partial<Evidence> = {}): Evidence {
  return {
    callId: "call_test",
    platform: "retell",
    agentVersion: null,
    tier: 1,
    ordering: "sequence",
    callFields: {},
    callStartMs: null,
    items: items.map((it, i) => ({ ...it, seq: i + 1 }) as Item),
    gaps: [],
    ...over,
  };
}

/**
 * What the M1 engine should output for a sample. M1 runs only the scheduling pack, so the healthcare pack's
 * verified_before_change result is dropped and the policy lists scheduling alone. Nothing else changes: the
 * dropped result passed or did not apply in every sample, so the verdict, notes and headline stay the same.
 */
export function m1View(sample: CallReport): CallReport {
  const view = structuredClone(sample);
  view.policy.packs = ["scheduling"];
  view.results = view.results.filter((r) => r.contract !== "verified_before_change");
  return view;
}

/** The report, typed, when it validates; otherwise throws with every zod issue as "path: message". */
export function assertValidReport(report: unknown): CallReport {
  const parsed = CallReportSchema.safeParse(report);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  throw new Error(`invalid report:\n${issues.join("\n")}`);
}
