// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { APIConnectionError, APIConnectionTimeoutError, AuthenticationError, InternalServerError, PermissionDeniedError, RateLimitError } from "retell-sdk";
import { logSafe, redact, safeError } from "./redact";

const KEY = "key_REDACTTEST0123456789abcdef";

afterEach(() => vi.restoreAllMocks());

describe("redact", () => {
  it("removes the key wherever it appears", () => {
    const out = redact(`401 {"error":"bad key ${KEY}"} again ${KEY}`, KEY);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain("REDACTTEST");
    expect(out).toContain("[redacted]");
  });

  it("removes Bearer text, whatever the token", () => {
    const out = redact("Authorization: Bearer abc.def-ghi_123 and bearer xyz", "");
    expect(out).not.toContain("abc.def-ghi_123");
    expect(out).not.toContain("xyz");
  });

  it("removes anything shaped like a Retell key even when the key is not known", () => {
    const out = redact("failed for key_0123456789abcdefOTHER", undefined);
    expect(out).not.toContain("0123456789abcdefOTHER");
  });

  it("leaves ordinary text alone", () => {
    expect(redact("could not reach Retell", KEY)).toBe("could not reach Retell");
  });
});

describe("safeError", () => {
  const headers = new Headers({ "retry-after": "2" });

  it("reduces an SDK error to name, status and code, dropping the body that echoes the key", () => {
    const err = new AuthenticationError(401, { message: `Invalid key ${KEY}` }, undefined, headers);
    expect(err.message).toContain(KEY);
    const safe = safeError(err);
    expect(safe).toEqual({ name: "AuthenticationError", status: 401, code: "bad_key" });
    expect(JSON.stringify(safe)).not.toContain("REDACTTEST");
  });

  it("maps each kind of failure to a short code", () => {
    expect(safeError(new PermissionDeniedError(403, {}, undefined, headers)).code).toBe("bad_key");
    expect(safeError(new RateLimitError(429, { key: KEY }, undefined, headers))).toEqual({ name: "RateLimitError", status: 429, code: "rate_limited" });
    expect(safeError(new InternalServerError(500, { key: KEY }, undefined, headers))).toEqual({ name: "InternalServerError", status: 500, code: "retell_down" });
    expect(safeError(new APIConnectionError({ message: `fetch failed ${KEY}` }))).toEqual({ name: "APIConnectionError", code: "network" });
    expect(safeError(new APIConnectionTimeoutError())).toEqual({ name: "APIConnectionTimeoutError", code: "network" });
    expect(safeError(new Error(`boom ${KEY}`))).toEqual({ name: "Error", code: "unknown" });
  });

  it("copes with things that are not errors", () => {
    for (const thing of [KEY, null, undefined, 42, { message: KEY }, Object.create(null)]) {
      const safe = safeError(thing);
      expect(JSON.stringify(safe)).not.toContain("REDACTTEST");
      expect(safe.code).toBe("unknown");
    }
  });

  it("never copies a name an attacker could fill", () => {
    const err = new Error("x");
    err.name = `Bad ${KEY}`;
    class Weird extends Error {}
    Object.defineProperty(Weird, "name", { value: KEY });
    expect(JSON.stringify(safeError(err))).not.toContain("REDACTTEST");
    expect(JSON.stringify(safeError(new Weird("y")))).not.toContain("REDACTTEST");
  });
});

describe("logSafe", () => {
  it("writes one line with the event and its fields", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSafe("connect.check_failed", { status: 401, code: "bad_key", retry: false });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("connect.check_failed");
    expect(line).toContain("401");
    expect(line).toContain("bad_key");
  });

  it("redacts Bearer text and key-shaped strings in its fields and its event name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSafe(`oops ${KEY}`, { detail: `Bearer ${KEY}`, other: KEY });
    const line = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(line).not.toContain("REDACTTEST");
  });

  it("drops anything that is not a string, number or boolean", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSafe("x", { obj: { apiKey: KEY } as unknown as string });
    const line = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(line).not.toContain("REDACTTEST");
  });
});
