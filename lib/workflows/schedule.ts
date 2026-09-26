import { CronExpressionParser } from "cron-parser";

/** Friendly schedule presets (spec §45) → cron expressions. */
export const SCHEDULE_PRESETS = [
  { key: "daily_8am", label: "Every morning at 8:00", cron: "0 8 * * *" },
  { key: "weekdays_9am", label: "Every weekday at 9:00", cron: "0 9 * * 1-5" },
  { key: "monday_9am", label: "Every Monday at 9:00", cron: "0 9 * * 1" },
  { key: "hourly", label: "Every hour", cron: "0 * * * *" },
  { key: "every_30m", label: "Every 30 minutes", cron: "*/30 * * * *" },
  { key: "custom", label: "Custom cron", cron: "" },
] as const;

export function validateCron(expr: string): string | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return "Use a 5-field cron expression: minute hour day month weekday.";
  try {
    CronExpressionParser.parse(expr, { tz: "UTC" });
    return null;
  } catch (err) {
    return `Invalid cron expression: ${(err as Error).message}`;
  }
}

/** Next run time strictly after `from`, evaluated in the organization's timezone. */
export function nextRunAt(expr: string, timezone: string, from = new Date()): Date {
  return CronExpressionParser.parse(expr, { currentDate: from, tz: timezone }).next().toDate();
}

/** Guards against runaway schedules: at most one run every 5 minutes. */
export function tooFrequent(expr: string, timezone: string): boolean {
  const it = CronExpressionParser.parse(expr, { currentDate: new Date(), tz: timezone });
  const a = it.next().toDate().getTime();
  const b = it.next().toDate().getTime();
  return b - a < 5 * 60 * 1000;
}

export function describeCron(expr: string): string {
  const preset = SCHEDULE_PRESETS.find((p) => p.cron === expr.trim());
  return preset ? preset.label : `Cron: ${expr}`;
}
