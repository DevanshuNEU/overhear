// The search half of the live canary (scripts/canary-live.ts): given a key, look for any form of it (see
// src/pull/canary-forms.ts) in text and in every file under a folder. Nothing here prints or returns the key: a
// finding names the place and the kind of form, so the report can be pasted into an issue.
import fs from "node:fs";
import path from "node:path";
import { type Canary, labeledForms } from "../../src/pull/canary-forms";

export type Finding = { place: string; found: string };

export type Searcher = {
  /** The kind of form found in `data`, or null. */
  inText(data: string | Buffer): string | null;
  /** One finding per file under `dir` that holds a form. Symlinks are not followed. Files in `skip` are left out. */
  inTree(dir: string, label: string, skip?: (file: string) => boolean): Finding[];
};

export function makeSearcher(canary: Canary): Searcher {
  // Each form is searched as raw bytes, so a binary cache file is searched like a text file. The 8-character
  // windows of the key cover every longer plain form, so the long ones are only there to name what was found.
  const forms = labeledForms(canary).map(({ label, form }) => ({ label, bytes: Buffer.from(form, "utf8") }));

  function inText(data: string | Buffer): string | null {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    for (const f of forms) if (buf.includes(f.bytes)) return f.label;
    return null;
  }

  function inTree(dir: string, label: string, skip: (file: string) => boolean = () => false): Finding[] {
    const found: Finding[] = [];
    const walk = (current: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && !skip(full)) {
          let data: Buffer;
          try {
            data = fs.readFileSync(full);
          } catch {
            continue;
          }
          const hit = inText(data);
          if (hit) found.push({ place: `${label}/${path.relative(dir, full).split(path.sep).join("/")}`, found: hit });
          // A file name can hold the key too (a temp file named after it).
          const named = inText(entry.name);
          if (named && !hit) found.push({ place: `${label}/${path.relative(dir, full).split(path.sep).join("/")} (its name)`, found: named });
        }
      }
    };
    walk(dir);
    return found;
  }

  return { inText, inTree };
}
