// A JSON request's body text with a hard size limit, for the routes that take a small body (pins, test calls).
// The code it refuses with is one of the codes both route sets know.

export type BodyRefusal = "unsupported" | "body_too_large" | "bad_request";

/**
 * The request's body text, or the code that refuses it. The body is read chunk by chunk and the read stops, and the rest
 * is cancelled, as soon as it passes `max` bytes, so a chunked body with no Content-Length is never read in full.
 */
export async function boundedBodyText(request: Request, max: number): Promise<{ text: string } | { code: BodyRefusal }> {
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) return { code: "unsupported" };
  if (Number(request.headers.get("content-length") ?? "0") > max) return { code: "body_too_large" };
  if (request.body === null) return { text: "" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel().catch(() => {});
        return { code: "body_too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { code: "bad_request" };
  }
  return { text: Buffer.concat(chunks).toString("utf8") };
}
