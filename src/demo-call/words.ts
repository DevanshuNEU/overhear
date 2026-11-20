// Every failure of the demo call routes is one of these codes and its fixed sentence. Never a word of Retell's answer, never the key.
export type DemoCallErrorCode = "not_found" | "rate_limited" | "not_configured" | "forbidden" | "unreadable" | "unavailable" | "failed";

export const DEMO_CALL_MESSAGE: Record<DemoCallErrorCode, string> = {
  not_found: "This call is not available.",
  rate_limited: "The demo is busy. Try again in a few minutes.",
  not_configured: "The demo agent is not set up on this copy.",
  forbidden: "This request did not come from this site.",
  unreadable: "Retell’s answer could not be read.",
  unavailable: "Retell could not be reached.",
  failed: "The demo call could not be started.",
};

export const DEMO_CALL_STATUS: Record<DemoCallErrorCode, number> = {
  not_found: 404,
  rate_limited: 429,
  not_configured: 503,
  forbidden: 403,
  unreadable: 502,
  unavailable: 502,
  failed: 500,
};
