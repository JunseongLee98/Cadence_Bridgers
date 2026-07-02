import { describe, expect, it, vi, afterEach } from 'vitest';
import { getPublicFeedOrigin, buildCalendarFeedUrl } from '@/lib/calendar-feed-url';
import { CADENCE_PUBLIC_APP_URL } from '@/lib/cadence-public-url';
import { filterEventsForCalendarFeed } from '@/lib/calendar-feed-events';
import { buildIcsCalendar } from '@/lib/ics-export';
import type { CalendarEvent } from '@/types';

describe('calendar feed url', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('uses public Cadence URL when env is localhost', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000');
    vi.stubGlobal('window', { location: { origin: 'http://localhost:3000' } });
    expect(getPublicFeedOrigin()).toBe(CADENCE_PUBLIC_APP_URL);
    const url = buildCalendarFeedUrl(getPublicFeedOrigin(), 'test-token');
    expect(url).toBe(`${CADENCE_PUBLIC_APP_URL}/cadence/feed/test-token.ics`);
  });
});

describe('calendar feed events', () => {
  it('excludes Google and ICS subscription mirrors', () => {
    const events: CalendarEvent[] = [
      {
        id: 'google-1',
        title: 'G',
        start: new Date(),
        end: new Date(),
        isScheduled: false,
      },
      {
        id: 'ics-sub-1',
        title: 'S',
        start: new Date(),
        end: new Date(),
        isScheduled: false,
      },
      {
        id: 'scheduled-t1-1',
        title: 'Study',
        start: new Date('2026-06-01T14:00:00.000Z'),
        end: new Date('2026-06-01T15:00:00.000Z'),
        isScheduled: true,
        taskId: 't1',
      },
    ];
    const filtered = filterEventsForCalendarFeed(events);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toBe('Study');
  });
});

describe('ics export', () => {
  it('builds a valid VCALENDAR with VEVENT', () => {
    const ics = buildIcsCalendar([
      {
        id: 'scheduled-t1-1',
        title: 'Essay draft',
        start: new Date('2026-06-01T14:00:00.000Z'),
        end: new Date('2026-06-01T15:00:00.000Z'),
        isScheduled: true,
        taskId: 't1',
      },
    ]);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('SUMMARY:Essay draft');
    expect(ics).toContain('END:VCALENDAR');
  });
});
