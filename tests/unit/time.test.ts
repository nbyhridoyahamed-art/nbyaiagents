import { describe, expect, it } from "vitest";
import { hourInTimeZone, startOfDayInTimeZone, startOfMonthInTimeZone } from "@/lib/time";

describe("time zone boundaries", () => {
  const now = new Date("2026-09-26T02:30:00Z");

  it("uses the company's calendar day, not UTC's", () => {
    expect(startOfDayInTimeZone("UTC", now).toISOString()).toBe("2026-09-26T00:00:00.000Z");
    // 02:30 UTC is still Sept 25 in New York (EDT, UTC-4) → midnight is 04:00 UTC on the 25th.
    expect(startOfDayInTimeZone("America/New_York", now).toISOString()).toBe("2026-09-25T04:00:00.000Z");
    // Dhaka is UTC+6 → already 08:30 on the 26th; midnight was 18:00 UTC on the 25th.
    expect(startOfDayInTimeZone("Asia/Dhaka", now).toISOString()).toBe("2026-09-25T18:00:00.000Z");
  });

  it("handles month starts and DST changes", () => {
    expect(startOfMonthInTimeZone("UTC", now).toISOString()).toBe("2026-09-01T00:00:00.000Z");
    // Nov 1 2026 is the US DST change day; midnight is still EDT (UTC-4).
    expect(startOfDayInTimeZone("America/New_York", new Date("2026-11-01T15:00:00Z")).toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("falls back to UTC for an invalid zone", () => {
    expect(startOfDayInTimeZone("Not/AZone", now).toISOString()).toBe("2026-09-26T00:00:00.000Z");
    expect(hourInTimeZone("Asia/Dhaka", now)).toBe(8);
  });
});
