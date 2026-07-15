import { describe, expect, it } from 'vitest';
import { isAllDayLikeEvent } from '@/lib/calendar-event-utils';

describe('isAllDayLikeEvent', () => {
  it('detects full-day midnight-to-midnight', () => {
    expect(
      isAllDayLikeEvent({
        start: new Date(2026, 3, 13, 0, 0, 0, 0),
        end: new Date(2026, 3, 14, 0, 0, 0, 0),
      })
    ).toBe(true);
  });

  it('detects zero-duration midnight placeholders', () => {
    expect(
      isAllDayLikeEvent({
        start: new Date(2026, 3, 13, 0, 0, 0, 0),
        end: new Date(2026, 3, 13, 0, 0, 0, 0),
      })
    ).toBe(true);
  });

  it('does not treat timed events as all-day', () => {
    expect(
      isAllDayLikeEvent({
        start: new Date(2026, 3, 13, 9, 0, 0, 0),
        end: new Date(2026, 3, 13, 9, 30, 0, 0),
      })
    ).toBe(false);
  });
});
