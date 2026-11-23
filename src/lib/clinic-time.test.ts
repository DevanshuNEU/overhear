import { describe, expect, it } from "vitest";
import { isIanaZone, localDate, localHour, offsetMinutes, toLocalIso, zonedInstant } from "./clinic-time";

describe("clinic time", () => {
  it("reads the Eastern offset on each side of the November change", () => {
    expect(offsetMinutes(new Date("2026-11-01T04:00:00Z"))).toBe(-240); // still daylight time
    expect(offsetMinutes(new Date("2026-11-01T07:00:00Z"))).toBe(-300); // standard time
  });

  it("writes the local ISO with the right offset", () => {
    expect(toLocalIso(new Date("2026-11-23T14:00:00Z"))).toBe("2026-11-23T09:00:00-05:00");
    expect(toLocalIso(new Date("2026-07-06T13:00:00Z"))).toBe("2026-07-06T09:00:00-04:00");
  });

  it("finds the clinic date and hour, past the UTC midnight", () => {
    const d = new Date("2026-11-23T00:36:00Z"); // 7:36 pm Sunday in New York
    expect(localDate(d)).toBe("2026-11-22");
    expect(localHour(d)).toBe(19);
  });

  it("makes the same wall-clock hour on both sides of the daylight saving change", () => {
    expect(zonedInstant(2026, 10, 30, 9).toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(zonedInstant(2026, 11, 2, 9).toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(zonedInstant(2027, 3, 15, 9).toISOString()).toBe("2027-03-15T13:00:00.000Z");
    expect(zonedInstant(2027, 3, 12, 9).toISOString()).toBe("2027-03-12T14:00:00.000Z");
  });

  it("accepts real zones and refuses everything else", () => {
    expect(isIanaZone("America/Los_Angeles")).toBe(true);
    expect(isIanaZone("Asia/Kolkata")).toBe(true);
    expect(isIanaZone("Mars/Olympus")).toBe(false);
    expect(isIanaZone("")).toBe(false);
    expect(isIanaZone("a".repeat(65))).toBe(false);
    expect(isIanaZone("America/New York; drop")).toBe(false);
    expect(isIanaZone(5)).toBe(false);
  });
});
