import type { CalendarEvent } from '@/types';
import { SCHEDULE_MAX_HORIZON_DAYS } from '@/lib/schedule-constants';
import { parseLocalDateInput } from '@/lib/date-utils';

export type GoogleCalendarListItem = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  backgroundColor?: string;
  selected?: boolean;
};

const GOOGLE_CALENDAR_COLORS = [
  '#4285f4', // Google blue
  '#34a853', // green
  '#fbbc04', // yellow
  '#ea4335', // red
  '#a142f4', // purple
  '#24c1e0', // cyan
  '#ff6d01', // orange
  '#e67c73', // coral
];

function colorForCalendarId(calendarId: string, fallback?: string): string {
  if (fallback) return fallback;
  let hash = 0;
  for (let i = 0; i < calendarId.length; i += 1) {
    hash = (hash * 31 + calendarId.charCodeAt(i)) >>> 0;
  }
  return GOOGLE_CALENDAR_COLORS[hash % GOOGLE_CALENDAR_COLORS.length];
}

function parseGoogleDate(value: string | undefined): Date {
  if (!value) return new Date();
  // Google returns all-day events as YYYY-MM-DD (no time). Parse as LOCAL midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseLocalDateInput(value);
  }
  return new Date(value);
}

/** List calendars visible to the signed-in user. */
export async function listGoogleCalendarsRest(
  accessToken: string
): Promise<GoogleCalendarListItem[]> {
  const out: GoogleCalendarListItem[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      maxResults: '250',
      minAccessRole: 'reader',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const err = new Error(text || response.statusText) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    const data = (await response.json()) as {
      items?: Array<{
        id?: string;
        summary?: string;
        primary?: boolean;
        accessRole?: string;
        backgroundColor?: string;
        selected?: boolean;
      }>;
      nextPageToken?: string;
    };

    for (const item of data.items ?? []) {
      if (!item.id) continue;
      out.push({
        id: item.id,
        summary: item.summary || item.id,
        primary: item.primary === true,
        accessRole: item.accessRole,
        backgroundColor: item.backgroundColor,
        selected: item.selected,
      });
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  // Primary first, then alphabetical.
  out.sort((a, b) => {
    if (a.primary && !b.primary) return -1;
    if (!a.primary && b.primary) return 1;
    return a.summary.localeCompare(b.summary);
  });

  return out;
}

async function fetchEventsForCalendar(
  accessToken: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date,
  color?: string
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '2500',
  });

  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const err = new Error(text || response.statusText) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  const data = await response.json();
  const items = (data.items || []) as Array<{
    id?: string;
    summary?: string;
    description?: string;
    start?: { dateTime?: string; date?: string };
    end?: { dateTime?: string; date?: string };
  }>;

  const eventColor = colorForCalendarId(calendarId, color);

  return items.map((event): CalendarEvent => {
    const startRaw = event.start?.dateTime || event.start?.date;
    const endRaw = event.end?.dateTime || event.end?.date;
    const googleEventId = event.id || `${Date.now()}-${Math.random()}`;
    const description =
      typeof event.description === 'string' && event.description.trim()
        ? event.description
        : undefined;

    return {
      // Prefix so events from different calendars never collide in the UI merge.
      id: `google-${calendarId}-${googleEventId}`,
      title: event.summary || '(No title)',
      ...(description ? { description } : {}),
      start: parseGoogleDate(startRaw),
      end: parseGoogleDate(endRaw),
      isScheduled: false,
      color: eventColor,
      taskId: undefined,
    };
  });
}

/**
 * Fetch events via Google Calendar API REST (no googleapis).
 * Pass an empty calendarIds array to fetch nothing.
 * When calendarIds is undefined/omitted, defaults to primary.
 */
export async function fetchGoogleCalendarEventsRest(
  accessToken: string,
  timeMin?: Date,
  timeMax?: Date,
  calendarIds?: string[],
  colorsByCalendarId?: Record<string, string>
): Promise<CalendarEvent[]> {
  const now = new Date();
  const minTime = timeMin || now;
  const maxTime =
    timeMax ||
    new Date(now.getTime() + SCHEDULE_MAX_HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const ids =
    calendarIds === undefined
      ? ['primary']
      : Array.from(new Set(calendarIds.map((id) => id.trim()).filter(Boolean)));

  if (ids.length === 0) return [];

  const results = await Promise.all(
    ids.map((id) =>
      fetchEventsForCalendar(
        accessToken,
        id,
        minTime,
        maxTime,
        colorsByCalendarId?.[id]
      )
    )
  );

  return results.flat().sort((a, b) => a.start.getTime() - b.start.getTime());
}
