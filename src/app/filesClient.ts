// What the browser does with the files a person opens: check the limits, read each file with File.text(), send them
// to /api/files and give back the rows and the files that were set aside. Every sentence is fixed; nothing a file
// contains is shown. The server checks the same limits again.
import { FILES_MESSAGE, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, type FileProblem, type FilesError } from "@/files/labels";
import { LOCAL_REFUSAL } from "@/pull/labels";
import type { PullRow } from "@/pull/pull";
import { isRec } from "./callClient";
import { FILES_WORDS } from "./filesWords";

export type FilesAnswer = { rows: PullRow[]; problems: FileProblem[] };
export type OpenResult = ({ ok: true } & FilesAnswer) | { ok: false; message: string };

const JSON_HEADERS = { "content-type": "application/json" };
const REFUSALS = new Set<string>(Object.values(LOCAL_REFUSAL));

/** The rows and problems in an answer from /api/files, or null when it is not one. */
export function readFilesAnswer(body: unknown): FilesAnswer | null {
  if (!isRec(body) || !Array.isArray(body.rows) || !Array.isArray(body.problems)) return null;
  const rows = body.rows.every((r) => isRec(r) && typeof r.callId === "string" && typeof r.state === "string");
  const problems = body.problems.every((p) => isRec(p) && typeof p.file === "string" && typeof p.reason === "string");
  return rows && problems ? { rows: body.rows as PullRow[], problems: body.problems as FileProblem[] } : null;
}

async function failureOf(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body: unknown = JSON.parse(text);
    const code = isRec(body) ? body.error : undefined;
    if (typeof code === "string" && code in FILES_MESSAGE) return FILES_MESSAGE[code as FilesError];
  } catch {
    // The local check answers in plain text.
  }
  return REFUSALS.has(text) ? text : FILES_WORDS.serverDown;
}

/**
 * Reads the files and sends them. Refuses on the count and the total before reading anything. A file over 5 MB is not
 * read: only its name goes, marked too large, and it is listed with the files that were set aside.
 */
export async function openReportFiles(files: File[]): Promise<OpenResult> {
  if (files.length === 0) return { ok: false, message: FILES_WORDS.noneRead };
  if (files.length > MAX_FILES) return { ok: false, message: FILES_MESSAGE.too_many_files };
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) return { ok: false, message: FILES_MESSAGE.too_large_total };
  const send: { name: string; text?: string; tooLarge?: true }[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) send.push({ name: file.name, tooLarge: true });
    else send.push({ name: file.name, text: await file.text().catch(() => "") });
  }
  try {
    const res = await fetch("/api/files", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ files: send }), cache: "no-store" });
    if (!res.ok) return { ok: false, message: await failureOf(res) };
    const answer = readFilesAnswer(await res.json().catch(() => null));
    return answer ? { ok: true, ...answer } : { ok: false, message: FILES_WORDS.serverDown };
  } catch {
    return { ok: false, message: FILES_WORDS.serverDown };
  }
}

/** Empties what the server holds. True when it did. */
export async function clearReportFiles(): Promise<boolean> {
  try {
    const res = await fetch("/api/files", { method: "DELETE", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
