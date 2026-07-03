import type { SerializedFeedEvent } from '@/lib/calendar-feed-events';

const GOOGLE_API = 'https://www.googleapis.com/calendar/v3';
const CADENCE_CALENDAR_SUMMARY = 'Cadence';
const CADENCE_MANAGED_KEY = 'cadenceManaged';
const CADENCE_EVENT_ID_KEY = 'cadenceEventId';

export class GoogleAuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

export type GooglePushResult = {
  calendarId: string;
  created: number;
  updated: number;
  deleted: number;
};

type GoogleEvent = {
  id?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
};

async function googleFetch(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const res = await fetch(`${GOOGLE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 401) {
    throw new GoogleAuthError('Google access token expired or invalid');
  }
  return res;
}

/** Find the Cadence secondary calendar, creating it if needed. Returns its id. */
export async function ensureCadenceCalendar(accessToken: string): Promise<string> {
  const listRes = await googleFetch(
    accessToken,
    '/users/me/calendarList?maxResults=250&minAccessRole=owner'
  );
  if (listRes.ok) {
    const data = (await listRes.json()) as {
      items?: Array<{ id: string; summary?: string }>;
    };
    const existing = data.items?.find((c) => c.summary === CADENCE_CALENDAR_SUMMARY);
    if (existing) return existing.id;
  }

  const createRes = await googleFetch(accessToken, '/calendars', {
    method: 'POST',
    body: JSON.stringify({
      summary: CADENCE_CALENDAR_SUMMARY,
      description: 'Tasks scheduled by Cadence.',
      timeZone: 'UTC',
    }),
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '');
    throw new Error(`Failed to create Cadence calendar: ${text || createRes.statusText}`);
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

function fingerprint(e: {
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
}): string {
  return `${e.start ?? ''}|${e.end ?? ''}|${e.summary ?? ''}|${e.description ?? ''}`;
}

function eventBody(row: SerializedFeedEvent) {
  return {
    summary: row.title,
    description: row.description || undefined,
    start: { dateTime: new Date(row.start).toISOString(), timeZone: 'UTC' },
    end: { dateTime: new Date(row.end).toISOString(), timeZone: 'UTC' },
    extendedProperties: {
      private: {
        [CADENCE_MANAGED_KEY]: 'true',
        [CADENCE_EVENT_ID_KEY]: row.id,
      },
    },
  };
}

async function listManagedEvents(
  accessToken: string,
  calendarId: string
): Promise<GoogleEvent[]> {
  const out: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      maxResults: '2500',
      showDeleted: 'false',
      singleEvents: 'true',
      privateExtendedProperty: `${CADENCE_MANAGED_KEY}=true`,
    });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await googleFetch(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Failed to list Cadence events: ${text || res.statusText}`);
    }
    const data = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    out.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Reconcile the desired Cadence events into the user's Cadence Google calendar:
 * create new ones, update changed ones, and delete removed/completed ones.
 */
export async function syncEventsToGoogle(
  accessToken: string,
  desired: SerializedFeedEvent[],
  knownCalendarId?: string
): Promise<GooglePushResult> {
  const calendarId = knownCalendarId || (await ensureCadenceCalendar(accessToken));

  const existing = await listManagedEvents(accessToken, calendarId);
  const existingByCadenceId = new Map<string, GoogleEvent>();
  for (const ev of existing) {
    const cadenceId = ev.extendedProperties?.private?.[CADENCE_EVENT_ID_KEY];
    if (cadenceId) existingByCadenceId.set(cadenceId, ev);
  }

  const desiredById = new Map<string, SerializedFeedEvent>();
  for (const row of desired) {
    if (new Date(row.end).getTime() > new Date(row.start).getTime()) {
      desiredById.set(row.id, row);
    }
  }

  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const [id, row] of desiredById) {
    const match = existingByCadenceId.get(id);
    const body = eventBody(row);
    if (!match) {
      const res = await googleFetch(
        accessToken,
        `/calendars/${encodeURIComponent(calendarId)}/events`,
        { method: 'POST', body: JSON.stringify(body) }
      );
      if (res.ok) created += 1;
      continue;
    }
    const before = fingerprint({
      summary: match.summary,
      description: match.description,
      start: match.start?.dateTime ? new Date(match.start.dateTime).toISOString() : '',
      end: match.end?.dateTime ? new Date(match.end.dateTime).toISOString() : '',
    });
    const after = fingerprint({
      summary: body.summary,
      description: body.description,
      start: body.start.dateTime,
      end: body.end.dateTime,
    });
    if (before !== after && match.id) {
      const res = await googleFetch(
        accessToken,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(match.id)}`,
        { method: 'PUT', body: JSON.stringify(body) }
      );
      if (res.ok) updated += 1;
    }
  }

  for (const [id, ev] of existingByCadenceId) {
    if (desiredById.has(id) || !ev.id) continue;
    const res = await googleFetch(
      accessToken,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(ev.id)}`,
      { method: 'DELETE' }
    );
    if (res.ok || res.status === 410) deleted += 1;
  }

  return { calendarId, created, updated, deleted };
}
