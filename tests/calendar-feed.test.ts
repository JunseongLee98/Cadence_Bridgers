import { describe, expect, it, vi, afterEach } from 'vitest';
import { getPublicFeedOrigin, getCalendarFeedSyncOrigin, buildCalendarFeedUrl, buildGoogleCalendarSubscribeUrl } from '@/lib/calendar-feed-url';
import { CADENCE_PUBLIC_APP_URL } from '@/lib/cadence-public-url';
import { filterEventsForCalendarFeed, mergeFeedEventSequences } from '@/lib/calendar-feed-events';
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
    expect(getCalendarFeedSyncOrigin()).toBe('http://localhost:3000');
    const url = buildCalendarFeedUrl(getPublicFeedOrigin(), 'test-token');
    expect(url).toBe(`${CADENCE_PUBLIC_APP_URL}/cadence/feed/test-token.ics`);
  });

  it('builds Google subscribe link from feed URL', () => {
    const feed = `${CADENCE_PUBLIC_APP_URL}/cadence/feed/abc.ics`;
    expect(buildGoogleCalendarSubscribeUrl(feed)).toBe(
      `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feed)}`
    );
  });
});

describe('calendar feed store', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('requires blob or redis on Vercel', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    vi.stubEnv('BLOB_STORE_ID', '');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    const { saveCalendarFeed } = await import('@/lib/calendar-feed-store');
    await expect(
      saveCalendarFeed({
        token: '93b8813e-1f1c-42ca-85bb-3a1034637412',
        updatedAt: new Date().toISOString(),
        events: [],
      })
    ).rejects.toThrow(/not configured on Vercel/);
  });
});

describe('calendar feed events', () => {
  it('bumps SEQUENCE when feed event content changes', () => {
    const existing = [
      {
        id: 'e1',
        title: 'Study',
        start: '2026-06-01T14:00:00.000Z',
        end: '2026-06-01T15:00:00.000Z',
        sequence: 2,
      },
    ];
    const incoming = [
      {
        id: 'e1',
        title: 'Study (updated)',
        start: '2026-06-01T14:00:00.000Z',
        end: '2026-06-01T15:00:00.000Z',
      },
    ];
    const merged = mergeFeedEventSequences(incoming, existing);
    expect(merged[0].sequence).toBe(3);
  });

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
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT5M');
    expect(ics).toContain('END:VCALENDAR');
  });
});
