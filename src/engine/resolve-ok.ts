// Success resolution (spec 6.1): every tool result gets the ok the evidence supports.
//
// In order: the platform's own field saying the tool failed (Retell `successful: false`) makes it false, whatever
// the body says. Otherwise the policy's success path, read from the payload, settles it when it reads a boolean. A
// tool's own path comes first; lookups ignore the top-level path and count as successful when their items path
// reads a list. Otherwise the platform's field saying it worked makes it true. With none of these, ok stays null and
// an unknown_success gap names the result. Nothing else ever makes ok true: text such as "OK", a 2xx-looking body or
// a truthy non-boolean is not read as success. Tier 2's backend actions join this order in M2.
import type { Evidence, Gap, Item, Policy } from "@/report/schema";
import { readPath } from "./paths";
import { toolPolicy } from "./policy";
import { unknownSuccessDetail } from "./wording";

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
    const ok = settle(it, call, policy);
    if (ok === null) {
      const gap: Gap = { code: "unknown_success", detail: unknownSuccessDetail(call?.name ?? "tool"), seqs: [it.seq] };
      if (call) gap.tool = call.name;
      gaps.push(gap);
    }
    return { ...it, ok };
  });
  return { ...ev, items, gaps };
}

/** The ok one result supports, or null when nothing says. */
function settle(result: ToolResult, call: ToolCall | undefined, policy: Policy): boolean | null {
  if (result.platformOk === false) return false;
  const tool = call ? toolPolicy(policy, call.name) : undefined;
  const roots = { args: call?.args, result: result.payload };
  const path = tool?.role === "lookup" ? tool.success : (tool?.success ?? policy.success);
  if (path !== undefined) {
    const value = readPath(path, roots);
    if (typeof value === "boolean") return value;
  }
  if (tool?.role === "lookup" && tool.items !== undefined && Array.isArray(readPath(tool.items, roots))) return true;
  return result.platformOk === true ? true : null;
}
