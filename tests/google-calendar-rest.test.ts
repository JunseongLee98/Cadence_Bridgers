import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchGoogleCalendarEventsRest } from '@/lib/google-calendar-rest';

describe('fetchGoogleCalendarEventsRest', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('maps Google API items to CalendarEvent', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => '',
      json: async () => ({
        items: [
          {
            id: 'evt1',
            summary: 'Meet',
            description: 'Bring notes from Canvas',
            start: { dateTime: '2026-05-01T15:00:00.000Z' },
            end: { dateTime: '2026-05-01T16:00:00.000Z' },
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const events = await fetchGoogleCalendarEventsRest('fake-token');
    expect(events.length).toBe(1);
    expect(events[0].title).toBe('Meet');
    expect(events[0].description).toBe('Bring notes from Canvas');
    expect(events[0].start.toISOString()).toContain('2026-05-01');
  });

  it('handles all-day date-only fields', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      text: async () => '',
      json: async () => ({
        items: [
          {
            id: 'all1',
            summary: 'Trip',
            start: { date: '2026-06-10' },
            end: { date: '2026-06-11' },
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const events = await fetchGoogleCalendarEventsRest('fake-token');
    expect(events[0].end.getTime()).toBeGreaterThanOrEqual(events[0].start.getTime());
    expect(events[0].start.getHours()).toBe(0);
    expect(events[0].start.getMinutes()).toBe(0);
  });

  it('throws with status on HTTP error', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'invalid_token',
    })) as unknown as typeof fetch;

    await expect(fetchGoogleCalendarEventsRest('bad')).rejects.toMatchObject({
      message: expect.stringContaining('invalid_token'),
    });
  });

  it('uses custom time window in query', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => '',
      json: async () => ({ items: [] }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const min = new Date('2026-01-01T00:00:00.000Z');
    const max = new Date('2026-01-02T00:00:00.000Z');
    await fetchGoogleCalendarEventsRest('tok', min, max);

    expect(fetchMock).toHaveBeenCalled();
    const url = String((fetchMock as any).mock.calls[0][0]);
    expect(url).toContain('timeMin=');
    expect(url).toContain('timeMax=');
  });
});
