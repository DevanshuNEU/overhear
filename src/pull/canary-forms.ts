// The forms a leaked key can take, shared by the two canaries: src/pull/canary.test.ts (route handlers, in process)
// and scripts/canary-live.ts (a real `next dev`). Test and tooling code only: nothing in the app imports this.
//
// The search looks for the key in plain text, hex and base64 (at every byte alignment, so a key inside a longer
// encoded string is found too), as Basic auth (`user:key` in base64), and as any 8-character window of the key or
// its marker.

export type Canary = { label?: string; key: string; marker: string };

/** A form of the key, and a name for it that is safe to print (it never holds the key). */
export type LabeledForm = { label: string; form: string };

/** Every 8-character window of a string. */
export function windows(text: string, size = 8): string[] {
  return Array.from({ length: Math.max(0, text.length - size + 1) }, (_, i) => text.slice(i, i + size));
}

/**
 * The base64 text that `text` always encodes to, wherever it sits in a longer string: for each of the three byte
 * alignments, encode it behind that much padding and keep only the 4-character groups made of its own bytes.
 */
export function base64Cores(text: string): string[] {
  return [0, 1, 2].flatMap((pad) => {
    const bytes = Buffer.from("a".repeat(pad) + text);
    const encoded = bytes.toString("base64");
    const core = encoded.slice(pad === 0 ? 0 : 4, Math.floor(bytes.length / 3) * 4);
    return [core, core.replace(/\+/g, "-").replace(/\//g, "_")];
  });
}

/** Every form of the key the search looks for, each with a printable name. The first name given to a form wins. */
export function labeledForms({ key, marker }: Canary): LabeledForm[] {
  const hex = (s: string) => Buffer.from(s).toString("hex");
  const b64 = (s: string) => Buffer.from(s).toString("base64");
  const all: LabeledForm[] = [
    { label: "the key in plain text", form: key },
    { label: "the marker in plain text", form: marker },
    { label: "the key as hex", form: hex(key) },
    { label: "the marker as hex", form: hex(marker) },
    { label: "the key as upper-case hex", form: hex(key).toUpperCase() },
    { label: "the marker as upper-case hex", form: hex(marker).toUpperCase() },
    { label: "the key as base64", form: b64(key) },
    { label: "the marker as base64", form: b64(marker) },
    ...[...base64Cores(key), ...base64Cores(marker)].map((form) => ({ label: "the key inside longer base64", form })),
    { label: "the key as Basic auth", form: b64(`user:${key}`) },
    { label: "the key as Basic auth with no user", form: b64(`:${key}`) },
    ...[...windows(key), ...windows(marker)].map((form) => ({ label: "an 8-character window of the key", form })),
  ];
  const seen = new Set<string>();
  return all.filter(({ form }) => {
    if (form.length < 8 || seen.has(form)) return false;
    seen.add(form);
    return true;
  });
}

/** Every form of the key the search looks for. */
export function forms(canary: Canary): string[] {
  return labeledForms(canary).map((f) => f.form);
}
