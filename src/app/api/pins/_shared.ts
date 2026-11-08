// What the pin routes share: the headers every answer carries and the one way an error leaves. An error is a PinErrorCode
// and its fixed sentence, never a word of the call, the key or what Retell said.
import { FRAME_HEADERS } from "@/pull/local";
import { PIN_MESSAGE, type PinErrorCode } from "@/pull/labels";

export const NO_STORE = { "cache-control": "no-store", ...FRAME_HEADERS };

const STATUS: Record<PinErrorCode, number> = {
  bad_request: 400,
  bad_call_id: 400,
  bad_pin_id: 400,
  unsupported: 415,
  body_too_large: 413,
  not_connected: 409,
  not_found: 404,
  not_ended: 409,
  mismatch: 409,
  unreadable: 409,
  no_report: 409,
  changed: 409,
  key_in_call: 409,
  no_such_pin: 404,
  not_a_file: 409,
  too_many: 409,
  too_large: 413,
  in_repo: 500,
  store_unsafe: 500,
  bad_key: 502,
  rate_limited: 429,
  network: 502,
  retell_down: 502,
  failed: 500,
};

export function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function failed(code: PinErrorCode): Response {
  return json({ error: code, message: PIN_MESSAGE[code] }, STATUS[code]);
}
