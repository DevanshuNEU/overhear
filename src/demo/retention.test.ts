import { afterEach, describe, expect, it, vi } from "vitest";

const purge = vi.fn(async () => {});
vi.mock("./ensure", () => ({ purge: (...a: unknown[]) => purge(...(a as [])) }));
vi.mock("@/db/client", () => ({ db: {} }));

import { RETENTION_EVERY_MS, startRetention } from "./retention";

afterEach(() => {
  purge.mockClear();
  vi.useRealTimers();
});

describe("startRetention", () => {
  it("does nothing in local mode or without a database", () => {
    expect(startRetention({ OVERHEAR_LOCAL: "1", DATABASE_URL: "postgres://x" })).toBeNull();
    expect(startRetention({})).toBeNull();
    expect(purge).not.toHaveBeenCalled();
  });

  it("purges at once on a hosted copy, then every hour, and stops when asked", async () => {
    vi.useFakeTimers();
    const stop = startRetention({ DATABASE_URL: "postgres://x" });
    expect(stop).not.toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(purge).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RETENTION_EVERY_MS);
    expect(purge).toHaveBeenCalledTimes(2);
    stop!();
    await vi.advanceTimersByTimeAsync(RETENTION_EVERY_MS * 3);
    expect(purge).toHaveBeenCalledTimes(2);
  });

  it("logs a fixed line, never the error, when the purge fails", async () => {
    vi.useFakeTimers();
    purge.mockRejectedValueOnce(new Error("row Jordan Ellis 1985-03-14"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stop = startRetention({ DATABASE_URL: "postgres://x" });
    await vi.advanceTimersByTimeAsync(0);
    expect(warn).toHaveBeenCalledWith("retention: could not purge the demo request log");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Jordan");
    stop!();
    warn.mockRestore();
  });
});
