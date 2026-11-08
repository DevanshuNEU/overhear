// What the agent list and test call routes share: the headers every answer carries and the one way an error leaves. An error
// is a TestCallErrorCode and its fixed sentence, never a word of the call, the key or what Retell said.
import { FRAME_HEADERS } from "@/pull/local";
import { TEST_CALL_MESSAGE, type TestCallErrorCode } from "@/pull/labels";

export const NO_STORE = { "cache-control": "no-store", ...FRAME_HEADERS };

const STATUS: Record<TestCallErrorCode, number> = {
  bad_request: 400,
  bad_agent: 400,
  bad_call_id: 400,
  unsupported: 415,
  body_too_large: 413,
  not_connected: 409,
  call_active: 409,
  not_found: 404,
  unreadable: 502,
  bad_key: 502,
  rate_limited: 429,
  network: 502,
  retell_down: 502,
  failed: 500,
};

export function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function failed(code: TestCallErrorCode): Response {
  return json({ error: code, message: TEST_CALL_MESSAGE[code] }, STATUS[code]);
}
