// Every word the local server says to a person: the connect answers and the refusals from the local check.
// The connect screen shows these strings as they are. Pure data, so the proxy can import it.

export type ConnectError = "bad_request" | "bad_key" | "unreachable" | "store_failed" | "home_unsafe" | "file_unsafe";

export const CONNECT_MESSAGE: Record<ConnectError, string> = {
  bad_request: "Paste a Retell API key.",
  bad_key: "Retell didn’t accept this key.",
  unreachable: "Couldn’t reach Retell. Check your connection and try again.",
  store_failed: "Couldn’t save the key on this computer.",
  home_unsafe: "The folder for your key is open to other users or isn’t yours, so Overhear won’t use it. Run chmod 700 on it, or set OVERHEAR_HOME to a new folder.",
  file_unsafe: "The saved key file can be read by other users or isn’t a plain file, so Overhear won’t read it. Disconnect and paste the key again.",
};

export const LOCAL_REFUSAL = {
  /** A hosted copy has no product routes. */
  notFound: "Not found.",
  /** A request whose Host is not this computer, or a change sent from another site. */
  forbidden: "Overhear only answers requests from this computer.",
  /** Local mode on a server that listens on more than this computer. */
  wrongBind: "Overhear holds your Retell key, so it only runs on 127.0.0.1. Start it with npm run local.",
  /** A body that is not JSON. */
  unsupported: "Send the key as JSON.",
  /** A body over the size limit. */
  tooLarge: "That is too long to be a Retell API key.",
} as const;

export type PullErrorCode = "bad_key" | "rate_limited" | "network" | "retell_down";

/** What a pull that stopped says, by cause. The call list shows these as they are. */
export const PULL_ERROR_MESSAGE: Record<PullErrorCode, string> = {
  bad_key: "Retell did not accept the stored key.",
  rate_limited: "Retell is limiting requests. Try again in a minute.",
  network: "Could not reach Retell.",
  retell_down: "Retell is having trouble right now.",
};

export type PinErrorCode =
  | "bad_request"
  | "bad_call_id"
  | "bad_pin_id"
  | "unsupported"
  | "body_too_large"
  | "not_connected"
  | "not_found"
  | "not_ended"
  | "mismatch"
  | "unreadable"
  | "no_report"
  | "changed"
  | "key_in_call"
  | "no_such_pin"
  | "not_a_file"
  | "too_many"
  | "too_large"
  | "in_repo"
  | "store_unsafe"
  | PullErrorCode
  | "failed";

/**
 * What the pin routes say, by code. Each is a fixed sentence: none ever holds a word of the call, the key or what
 * Retell answered. The pin screens show these as they are.
 */
export const PIN_MESSAGE: Record<PinErrorCode, string> = {
  bad_request: "Send the call and the items to keep as JSON, with a note of at most 280 characters.",
  bad_call_id: "That is not a Retell call id.",
  bad_pin_id: "That is not a pinned call id.",
  unsupported: "Send the request as JSON.",
  body_too_large: "That request is too long.",
  not_connected: "Connect your Retell key first.",
  not_found: "Retell does not have that call.",
  not_ended: "This call has not ended yet.",
  mismatch: "Retell sent back a different call, so nothing was kept.",
  unreadable: "Overhear could not read this call’s record, so nothing was kept.",
  no_report: "This call has no report, so it cannot be kept as a test.",
  changed: "This call reads differently now. Reload it and try again.",
  key_in_call: "This call holds your Retell key, so it was not saved.",
  no_such_pin: "No pinned call has that id.",
  not_a_file: "Something in the pinned folder with that name is a folder, not a pinned call. Remove it yourself.",
  too_many: "500 calls are already pinned. Delete some before pinning more.",
  too_large: "That call is too big to keep.",
  in_repo: "The pinned folder is inside a git repository, so Overhear won’t use it. Set OVERHEAR_HOME to a folder outside any repository.",
  store_unsafe: "The pinned folder is open to other users or isn’t yours, so Overhear won’t use it. Run chmod 700 on it, or set OVERHEAR_HOME to a new folder.",
  ...PULL_ERROR_MESSAGE,
  failed: "Something went wrong. Nothing was kept.",
};
