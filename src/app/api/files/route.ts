// The files the person opened in the browser. POST takes `{ files: [{ name, text }] }` (the browser reads each file with
// File.text()), checks each one with the engine and keeps the calls in memory (src/files/store.ts). GET answers the rows
// and the files that were set aside, DELETE empties the store. Local mode only: a hosted copy answers 404, and the
// loopback, Host and Origin checks run here as well as in src/proxy.ts. Errors say a fixed sentence and never repeat a
// file's contents.
import { FILES_MESSAGE, MAX_BODY_BYTES, MAX_FILES, MAX_TOTAL_BYTES, type FilesError } from "@/files/labels";
import { ingestFiles, type OpenedFile } from "@/files/ingest";
import { clearFiles, listFiles } from "@/files/store";
import { assertLocalRequest, FRAME_HEADERS } from "@/pull/local";

export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "no-store", ...FRAME_HEADERS };
const json = (body: Record<string, unknown>, status: number) => Response.json(body, { status, headers: HEADERS });
const refuse = (error: FilesError, status: number) => json({ error, message: FILES_MESSAGE[error] }, status);

/** The files in a request body, or the refusal for it. */
function readFiles(text: string): OpenedFile[] | Response {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse("bad_request", 400);
  }
  const files = typeof body === "object" && body !== null ? (body as { files?: unknown }).files : undefined;
  if (!Array.isArray(files) || files.length === 0) return refuse("bad_request", 400);
  if (files.length > MAX_FILES) return refuse("too_many_files", 413);
  const opened: OpenedFile[] = [];
  let total = 0;
  for (const f of files) {
    const item = typeof f === "object" && f !== null ? (f as { name?: unknown; text?: unknown; tooLarge?: unknown }) : null;
    if (item === null || typeof item.name !== "string") return refuse("bad_request", 400);
    // The browser did not read a file over the limit: only its name came.
    if (item.tooLarge === true && item.text === undefined) {
      opened.push({ name: item.name, text: "", tooLarge: true });
      continue;
    }
    if (typeof item.text !== "string") return refuse("bad_request", 400);
    total += Buffer.byteLength(item.text, "utf8");
    if (total > MAX_TOTAL_BYTES) return refuse("too_large_total", 413);
    // A file over the per-file limit is not parsed: ingestFiles lists it as too large.
    opened.push({ name: item.name, text: item.text });
  }
  return opened;
}

export async function POST(request: Request): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) return refuse("too_large_total", 413);
    const text = await request.text().catch(() => null);
    if (text === null) return refuse("bad_request", 400);
    if (text.length > MAX_BODY_BYTES) return refuse("too_large_total", 413);
    const opened = readFiles(text);
    if (opened instanceof Response) return opened;
    const problems = ingestFiles(opened);
    return json({ ...listFiles(), set: problems }, 200);
  } catch {
    return refuse("failed", 500);
  }
}

export async function GET(request: Request): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  return json({ ...listFiles() }, 200);
}

export async function DELETE(request: Request): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  clearFiles();
  return json({ cleared: true }, 200);
}
