/** Heuristic: Canvas/ICS/Google all-day rows (midnight start, ~0 or ≥23h duration). */
export function isAllDayLikeEvent(event: { start: Date; end: Date }): boolean {
  const start = event.start;
  const end = event.end;
  const startAtMidnight =
    start.getHours() === 0 && start.getMinutes() === 0 && start.getSeconds() === 0;
  const endAtMidnight =
    end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0;
  const durMs = end.getTime() - start.getTime();
  // Many ICS feeds represent all-day items as [00:00, 00:00 next day] (24h),
  // while Canvas sometimes exports assignment due dates as 00:00 with 0 duration.
  const isZeroDurationMidnight = durMs === 0 && startAtMidnight && endAtMidnight;
  const isFullDayOrMore = durMs >= 23 * 60 * 60 * 1000 && startAtMidnight && endAtMidnight;
  return isZeroDurationMidnight || isFullDayOrMore;
}
