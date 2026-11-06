// Success resolution (spec 6.1): every tool result gets the ok the evidence supports.
//
// In order: the platform's own field saying the tool failed (Retell `successful: false`) makes it false, whatever
// the body says. Otherwise the policy's success path, read from the payload, settles it when it reads a boolean. A
// tool's own path comes first; lookups ignore the top-level path and count as successful when their items path
// reads a list. Otherwise the platform's field saying it worked makes it true, with one exception: Retell's
// `successful: true` means only that the HTTP call came back, and an API can answer 200 with { "error": "slot taken" }.
// So a change or verify result whose body reads like an error (a truthy error or errors, ok or success false, a
// status of "error" or "failed") is unknown: not true, and not false either, since a heuristic read must not make a
// false "failed". With none of these, ok stays null and an unknown_success gap names the result. Nothing else ever
// makes ok true: text such as "OK" or a truthy non-boolean is not read as success, and neither is anything in the
// arguments. Tier 2's backend actions join this order in M2.
import type { Evidence, Gap, Item, Policy } from "@/report/schema";
import { readPath } from "./paths";
import { toolPolicy } from "./policy";
import { unknownSuccessConflictDetail, unknownSuccessDetail } from "./wording";

type ToolCall = Extract<Item, { kind: "tool_call" }>;
type ToolResult = Extract<Item, { kind: "tool_result" }>;

/**
 * The evidence with every tool result's ok settled from its payload and platformOk, replacing any ok already set.
 * unknown_success gaps are this function's own, so they are recomputed: other gaps are kept as given, and running
 * it twice gives the same evidence. Pure: the input is not changed.
 */
export function resolveOk(ev: Evidence, policy: Policy): Evidence {
  const calls = new Map<string, ToolCall>();
  for (const it of ev.items) if (it.kind === "tool_call" && !calls.has(it.id)) calls.set(it.id, it);

  const gaps: Gap[] = ev.gaps.filter((g) => g.code !== "unknown_success");
  const items = ev.items.map((it): Item => {
    if (it.kind !== "tool_result") return it;
    const call = calls.get(it.id);
    const { ok, readsLikeError } = settle(it, call, policy);
    if (ok === null) {
      const name = call?.name ?? "tool";
      const detail = readsLikeError ? unknownSuccessConflictDetail(name) : unknownSuccessDetail(name);
      const gap: Gap = { code: "unknown_success", detail, seqs: [it.seq] };
      if (call) gap.tool = call.name;
      gaps.push(gap);
    }
    return { ...it, ok };
  });
  return { ...ev, items, gaps };
}

/** The ok one result supports, or null when nothing says; readsLikeError marks a null that overrode successful: true. */
function settle(result: ToolResult, call: ToolCall | undefined, policy: Policy): { ok: boolean | null; readsLikeError: boolean } {
  const ok = (value: boolean | null, readsLikeError = false) => ({ ok: value, readsLikeError });
  if (result.platformOk === false) return ok(false);
  const tool = call ? toolPolicy(policy, call.name) : undefined;
  // Only the result is a root: what the agent sent (args) says nothing about whether the tool worked.
  const roots = { result: result.payload };
  const path = tool?.role === "lookup" ? tool.success : (tool?.success ?? policy.success);
  if (path !== undefined) {
    const value = readPath(path, roots);
    if (typeof value === "boolean") return ok(value);
  }
  if (tool?.role === "lookup" && tool.items !== undefined && Array.isArray(readPath(tool.items, roots))) return ok(true);
  if (result.platformOk !== true) return ok(null);
  if ((tool?.role === "change" || tool?.role === "verify") && readsLikeError(result.payload)) return ok(null, true);
  return ok(true);
}

/** A body that says it failed: a truthy error or errors, ok or success false, or a status of error or failed. */
function readsLikeError(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const body = payload as Record<string, unknown>;
  const own = (key: string) => (Object.hasOwn(body, key) ? body[key] : undefined);
  const present = (v: unknown) =>
    (typeof v === "string" && v.trim() !== "") || (Array.isArray(v) ? v.length > 0 : typeof v === "object" && v !== null);
  const status = own("status");
  return (
    present(own("error")) ||
    present(own("errors")) ||
    own("ok") === false ||
    own("success") === false ||
    (typeof status === "string" && ["error", "failed"].includes(status.trim().toLowerCase()))
  );
}
