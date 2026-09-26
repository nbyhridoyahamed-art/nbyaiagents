/**
 * Calendar boundaries in an organization's time zone. "Completed today" must mean
 * the company's today, not the server's.
 */

function zonedParts(timeZone: string, at: Date) {
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  }
  const parts = fmt.formatToParts(at);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Offset of `timeZone` from UTC at instant `at`, in milliseconds. */
function offsetMs(timeZone: string, at: Date) {
  const p = zonedParts(timeZone, at);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in `timeZone` to the UTC instant. */
function zonedToUtc(timeZone: string, year: number, month: number, day: number) {
  const guess = new Date(Date.UTC(year, month - 1, day));
  // Two passes handle days where the offset changes (DST).
  const first = new Date(guess.getTime() - offsetMs(timeZone, guess));
  return new Date(guess.getTime() - offsetMs(timeZone, first));
}

export function startOfDayInTimeZone(timeZone: string, now = new Date()): Date {
  const p = zonedParts(timeZone, now);
  return zonedToUtc(timeZone, p.year, p.month, p.day);
}

export function startOfMonthInTimeZone(timeZone: string, now = new Date()): Date {
  const p = zonedParts(timeZone, now);
  return zonedToUtc(timeZone, p.year, p.month, 1);
}

/** Hour of day (0–23) in the time zone — for greetings. */
export function hourInTimeZone(timeZone: string, now = new Date()): number {
  return zonedParts(timeZone, now).hour;
}
