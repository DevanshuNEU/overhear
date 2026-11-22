// The calls read from files the person opened, kept in memory for this run of the server: nothing is written to disk,
// and a restart or a clear empties it. One entry per call, keyed by the call id. Two files can carry the same call id
// (a copy, or two exports of one call): both are kept, the second under the call id plus a short suffix from its file
// name, and their rows say which file they came from. Opening the same file name again replaces that file's entry.
// The store lives on `globalThis`, so it survives dev hot reloads.
import type { PullRow } from "@/pull/pull";
import { rowFor } from "@/pull/pull";
import type { CallReport } from "@/report/schema";
import { MAX_CALLS, MAX_FILES, type FileProblem, type ProblemReason } from "./labels";

type Entry = { key: string; file: string; report: CallReport };
type Store = { entries: Map<string, Entry>; problems: FileProblem[] };

const SLOT = "__overhearFiles";

function store(): Store {
  const g = globalThis as { [SLOT]?: Store };
  return (g[SLOT] ??= { entries: new Map(), problems: [] });
}

/** A short, plain suffix from a file name: its name without the extension, letters and digits only, 8 at most. */
export function suffixOf(file: string): string {
  const stem = file.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9]/g, "");
  return stem.slice(0, 8) || "file";
}

/** The key a report from this file gets: its call id, or the call id plus a suffix when another file holds that id. */
function keyFor(entries: Map<string, Entry>, callId: string, file: string): string {
  const free = (key: string) => {
    const held = entries.get(key);
    return held === undefined || held.file === file;
  };
  if (free(callId)) return callId;
  const base = `${callId}~${suffixOf(file)}`;
  if (free(base)) return base;
  for (let n = 2; ; n++) if (free(`${base}-${n}`)) return `${base}-${n}`;
}

/** Adds one call from a file. "full" when the store holds MAX_CALLS and this call would be a new one. */
export function addReport(file: string, report: CallReport): "added" | "full" {
  const s = store();
  // Opening a file again replaces what it gave before, even when its call id changed.
  for (const [key, held] of s.entries) if (held.file === file && held.report.callId !== report.callId) s.entries.delete(key);
  const key = keyFor(s.entries, report.callId, file);
  if (!s.entries.has(key) && s.entries.size >= MAX_CALLS) return "full";
  s.problems = s.problems.filter((p) => p.file !== file);
  s.entries.set(key, { key, file, report });
  return "added";
}

/** Notes that a file could not be used. The same file opened again replaces its earlier note. */
export function addProblem(file: string, reason: ProblemReason): void {
  const s = store();
  s.problems = [...s.problems.filter((p) => p.file !== file), { file, reason }].slice(-MAX_FILES);
}

export function clearFiles(): void {
  const s = store();
  s.entries.clear();
  s.problems = [];
}

/** How many calls the store holds. */
export function fileCount(): number {
  return store().entries.size;
}

/** Whether anything was opened: a call, or a file that was set aside. */
export function hasFiles(): boolean {
  const s = store();
  return s.entries.size > 0 || s.problems.length > 0;
}

/** The report for a key. Keys are not call ids when two files shared one, so this is the lookup the report screen uses. */
export function getFileReport(key: string): CallReport | undefined {
  return store().entries.get(key)?.report;
}

/** The rows the list shows, newest call first (a call with no start time last), and the files that were set aside. */
export function listFiles(): { rows: PullRow[]; problems: FileProblem[] } {
  const s = store();
  const held = [...s.entries.values()];
  const shared = new Map<string, number>();
  for (const e of held) shared.set(e.report.callId, (shared.get(e.report.callId) ?? 0) + 1);
  const rows = held.map((e) => {
    const row = rowFor({ callId: e.key, startedAt: e.report.evidence.callStartMs ?? 0, durationMs: e.report.evidence.callFields.duration_ms ?? null, callStatus: "ended", agentId: null, dataStorageSetting: null }, { kind: "report", report: e.report });
    return { ...row, platform: e.report.platform, ...((shared.get(e.report.callId) ?? 0) > 1 ? { file: e.file } : {}) };
  });
  return { rows: rows.sort((a, b) => b.startedAt - a.startedAt), problems: [...s.problems] };
}
