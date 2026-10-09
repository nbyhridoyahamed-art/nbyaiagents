import { describe, expect, it } from "vitest";
import { runTimeLeftMs, workedMs } from "@/server/runtime/agent-runtime";

const MINUTE = 60_000;

describe("run clock", () => {
  it("counts the stretch in progress", () => {
    expect(workedMs({ activeMs: 0, resumedAt: 1_000 }, 1_000 + 3 * MINUTE)).toBe(3 * MINUTE);
  });

  it("adds earlier stretches but not the time spent waiting between them", () => {
    // Worked 2 minutes, waited an hour for a human, resumed and has worked 1 more minute.
    const state = { activeMs: 2 * MINUTE, resumedAt: 62 * MINUTE };
    expect(workedMs(state, 63 * MINUTE)).toBe(3 * MINUTE);
    expect(runTimeLeftMs(state, 63 * MINUTE)).toBe(7 * MINUTE);
  });

  it("stands still while the run is waiting for a human", () => {
    const paused = { activeMs: 4 * MINUTE, resumedAt: undefined };
    expect(workedMs(paused, 0)).toBe(4 * MINUTE);
    expect(workedMs(paused, 10 * 60 * MINUTE)).toBe(4 * MINUTE);
  });

  it("treats a run saved before working time was tracked as having used none yet", () => {
    expect(workedMs({}, 123_456_789)).toBe(0);
    expect(runTimeLeftMs({}, 123_456_789)).toBe(10 * MINUTE);
  });

  it("goes negative once the working time is spent", () => {
    expect(runTimeLeftMs({ activeMs: 11 * MINUTE, resumedAt: undefined })).toBeLessThan(0);
  });

  it("never runs backwards if a clock is skewed", () => {
    expect(workedMs({ activeMs: 0, resumedAt: 5_000 }, 1_000)).toBe(0);
  });
});
