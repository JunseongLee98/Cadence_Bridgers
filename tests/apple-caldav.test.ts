import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import {
  createAppleConnectionToken,
  decryptAppSpecificPassword,
  deleteAppleCredentials,
  encryptAppSpecificPassword,
  getAppleCredentials,
  saveAppleCredentials,
} from '@/lib/apple-credentials-store';
import {
  buildCadenceVEventIcs,
  extractCadenceIdFromIcs,
  mapDavCalendars,
  parseVEventData,
} from '@/lib/apple-caldav';
import type { DAVCalendar } from 'tsdav';

describe('apple credentials encryption', () => {
  const originalKey = process.env.APPLE_CREDENTIALS_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.APPLE_CREDENTIALS_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64');
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.APPLE_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.APPLE_CREDENTIALS_ENCRYPTION_KEY = originalKey;
  });

  it('round-trips app-specific password encryption', () => {
    const password = 'xxxx-xxxx-xxxx-xxxx';
    const enc = encryptAppSpecificPassword(password);
    expect(enc.iv).toBeTruthy();
    expect(enc.tag).toBeTruthy();
    expect(enc.ciphertext).toBeTruthy();
    expect(decryptAppSpecificPassword(enc)).toBe(password);
  });

  it('stores and loads credentials by connection token (local file fallback)', async () => {
    const token = createAppleConnectionToken();
    await saveAppleCredentials(token, {
      appleId: 'user@icloud.com',
      appSpecificPassword: 'abcd-efgh-ijkl-mnop',
    });
    const loaded = await getAppleCredentials(token);
    expect(loaded?.appleId).toBe('user@icloud.com');
    expect(loaded?.appSpecificPassword).toBe('abcd-efgh-ijkl-mnop');
    await deleteAppleCredentials(token);
    expect(await getAppleCredentials(token)).toBeNull();
  });
});

describe('apple caldav ICS helpers', () => {
  it('builds and extracts cadence id from VEVENT', () => {
    const ics = buildCadenceVEventIcs({
      id: 'task-123',
      title: 'Study; hard, chapter 1',
      description: 'Line1\nLine2',
      start: '2026-07-13T10:00:00.000Z',
      end: '2026-07-13T11:00:00.000Z',
    });
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:cadence-task-123@bridgerscadence.com');
    expect(ics).toContain('X-CADENCE-ID:task-123');
    expect(extractCadenceIdFromIcs(ics)).toBe('task-123');
  });

  it('parses foreign VEVENTs and skips cadence-managed ones', () => {
    const foreign = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:foreign-1',
      'DTSTART:20260713T150000Z',
      'DTEND:20260713T160000Z',
      'SUMMARY:Dentist',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const managed = buildCadenceVEventIcs({
      id: 'local-1',
      title: 'Cadence task',
      start: '2026-07-13T12:00:00.000Z',
      end: '2026-07-13T13:00:00.000Z',
    });

    const calUrl = 'https://caldav.icloud.com/123/calendars/home/';
    const foreignEvents = parseVEventData(foreign, calUrl);
    expect(foreignEvents.length).toBe(1);
    expect(foreignEvents[0].title).toBe('Dentist');
    expect(foreignEvents[0].id.startsWith('apple-')).toBe(true);

    const managedEvents = parseVEventData(managed, calUrl);
    expect(managedEvents.length).toBe(0);
  });

  it('maps DAV calendars and filters non-VEVENT collections', () => {
    const calendars = mapDavCalendars([
      { url: 'https://example/cal/home/', displayName: 'Home', components: ['VEVENT'] },
      { url: 'https://example/cal/tasks/', displayName: 'Reminders', components: ['VTODO'] },
      { url: 'https://example/cal/work/', displayName: 'Work' },
    ] as DAVCalendar[]);

    expect(calendars.map((c) => c.displayName)).toEqual(['Home', 'Work']);
  });
});

describe('syncEventsToApple', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/apple-caldav');
  });

  it('creates calendar objects for new cadence events', async () => {
    const createCalendarObject = vi.fn(async () => ({ ok: true, status: 201 }));
    const updateCalendarObject = vi.fn(async () => ({ ok: true, status: 204 }));
    const deleteCalendarObject = vi.fn(async () => ({ ok: true, status: 204 }));
    const fetchCalendarObjects = vi.fn(async () => []);
    const fetchCalendars = vi.fn(async () => [
      {
        url: 'https://caldav.icloud.com/x/calendars/cadence/',
        displayName: 'Cadence',
      },
    ]);

    vi.doMock('@/lib/apple-caldav', async () => {
      const actual = await vi.importActual<typeof import('@/lib/apple-caldav')>(
        '@/lib/apple-caldav'
      );
      return {
        ...actual,
        createAppleDavSession: vi.fn(async () => ({
          fetchCalendars,
          fetchCalendarObjects,
          createCalendarObject,
          updateCalendarObject,
          deleteCalendarObject,
          makeCalendar: vi.fn(),
        })),
        findOrCreateCadenceCalendar: vi.fn(async () => ({
          url: 'https://caldav.icloud.com/x/calendars/cadence/',
          displayName: 'Cadence',
        })),
      };
    });

    const { syncEventsToApple } = await import('@/lib/apple-calendar-push');
    const result = await syncEventsToApple(
      { appleId: 'a@b.com', appSpecificPassword: 'pass' },
      [
        {
          id: 'evt-1',
          title: 'Read chapter',
          start: '2026-07-14T10:00:00.000Z',
          end: '2026-07-14T11:00:00.000Z',
        },
      ]
    );

    expect(result.created).toBe(1);
    expect(result.calendarUrl).toContain('cadence');
    expect(createCalendarObject).toHaveBeenCalledTimes(1);
    expect(updateCalendarObject).not.toHaveBeenCalled();
    expect(deleteCalendarObject).not.toHaveBeenCalled();
  });
});
