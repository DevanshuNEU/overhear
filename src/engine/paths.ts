// Policy paths (spec 6.5): "result.slots", "item.startsAt", "args.flights.0.date". The first segment names a root:
// args (the tool call's arguments), result (the parsed result payload), item (one item of a lookup's list) or call
// (the call-level fields). The rest walk into it.
import { InputError } from "./types";

export type PathRoots = { args?: unknown; result?: unknown; item?: unknown; call?: unknown };

const ROOTS = new Set(["args", "result", "item", "call"]);

/**
 * The value a path names, or undefined when any step is missing. A bare root reads the whole root. A numeric
 * segment indexes an array; on an object it is an ordinary key. Only a value's own keys are read, so no path
 * reaches a prototype. Throws InputError for a path that is malformed or starts with no known root: that is a
 * policy mistake, not something the call data can cause.
 */
export function readPath(path: string, roots: PathRoots): unknown {
  const [root, ...rest] = path.split(".");
  if (!ROOTS.has(root) || rest.some((s) => s === "")) {
    throw new InputError(
      `The policy path "${path}" can't be read: it must start with args, result, item or call, with a name between every two dots.`,
      'Write the path from its root, such as "result.ok" or "item.startsAt".',
    );
  }
  let value: unknown = roots[root as keyof PathRoots];
  for (const segment of rest) {
    if (Array.isArray(value)) {
      value = /^\d+$/.test(segment) ? value[Number(segment)] : undefined;
    } else if (typeof value === "object" && value !== null && Object.hasOwn(value, segment)) {
      value = (value as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return value;
}
