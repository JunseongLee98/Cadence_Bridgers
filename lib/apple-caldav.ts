import { createDAVClient, type DAVCalendar } from 'tsdav';
import ICAL from 'ical.js';
import type { CalendarEvent } from '@/types';
import { SCHEDULE_MAX_HORIZON_DAYS } from '@/lib/schedule-constants';
import { parseLocalDateInput } from '@/lib/date-utils';

export const ICLOUD_CALDAV_URL = 'https://caldav.icloud.com';
export const CADENCE_CALENDAR_SUMMARY = 'Cadence';
export const CADENCE_X_PROP = 'x-cadence-id';

const APPLE_CALENDAR_COLORS = [
  '#5ac8fa',
  '#34c759',
  '#ffcc00',
  '#ff3b30',
  '#af52de',
  '#ff9500',
  '#5856d6',
  '#ff2d55',
];

export class AppleAuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = 'AppleAuthError';
  }
}

export type AppleCalendarListItem = {
  url: string;
  displayName: string;
  calendarColor?: string;
  components?: string[];
  readOnly?: boolean;
};

function colorForCalendarUrl(url: string, fallback?: string): string {
  if (fallback) return fallback;
  let hash = 0;
  for (let i = 0; i < url.length; i += 1) {
    hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
  }
  return APPLE_CALENDAR_COLORS[hash % APPLE_CALENDAR_COLORS.length];
}

function displayNameOf(calendar: DAVCalendar): string {
  const raw = calendar.displayName;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw && typeof raw === 'object') {
    const values = Object.values(raw).filter((v): v is string => typeof v === 'string');
    if (values[0]?.trim()) return values[0].trim();
  }
  try {
    const path = new URL(calendar.url).pathname;
    const seg = path.split('/').filter(Boolean).pop();
    if (seg) return decodeURIComponent(seg);
  } catch {
    // ignore
  }
  return calendar.url;
}

function isAuthFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status =
    ('status' in error && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : undefined) ??
    ('response' in error &&
    (error as { response?: { status?: number } }).response &&
    typeof (error as { response: { status?: number } }).response.status === 'number'
      ? (error as { response: { status: number } }).response.status
      : undefined);
  return status === 401 || status === 403;
}

/** createDAVClient returns a plain object with the same methods as DAVClient. */
export type AppleDavSession = Awaited<ReturnType<typeof createDAVClient>>;

export async function createAppleDavSession(creds: {
  appleId: string;
  appSpecificPassword: string;
}): Promise<AppleDavSession> {
  try {
    // defaultAccountType triggers account discovery (principal + calendar-home).
    return await createDAVClient({
      serverUrl: ICLOUD_CALDAV_URL,
      credentials: {
        username: creds.appleId.trim(),
        password: creds.appSpecificPassword.trim(),
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });
  } catch (error) {
    if (isAuthFailure(error)) {
      throw new AppleAuthError(
        'Apple Calendar credentials rejected. Check your Apple ID and app-specific password.'
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/401|unauthorized|forbidden|cannot find principal/i.test(message)) {
      throw new AppleAuthError(
        'Apple Calendar credentials rejected. Check your Apple ID and app-specific password.'
      );
    }
    throw error;
  }
}

export function mapDavCalendars(calendars: DAVCalendar[]): AppleCalendarListItem[] {
  const out: AppleCalendarListItem[] = [];
  for (const cal of calendars) {
    if (!cal.url) continue;
    const components = Array.isArray(cal.components)
      ? cal.components.map(String)
      : undefined;
    // Prefer VEVENT calendars; include unknowns (iCloud sometimes omits components).
    if (components && components.length > 0 && !components.includes('VEVENT')) {
      continue;
    }
    out.push({
      url: cal.url,
      displayName: displayNameOf(cal),
      calendarColor: cal.calendarColor,
      components,
      readOnly: false,
    });
  }
  out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return out;
}

export async function listAppleCalendars(creds: {
  appleId: string;
  appSpecificPassword: string;
}): Promise<AppleCalendarListItem[]> {
  const client = await createAppleDavSession(creds);
  try {
    const calendars = await client.fetchCalendars();
    return mapDavCalendars(calendars);
  } catch (error) {
    if (isAuthFailure(error)) {
      throw new AppleAuthError(
        'Apple Calendar session expired or app-specific password was revoked.'
      );
    }
    throw error;
  }
}

function formatCalDavTimeRange(d: Date): string {
  // CalDAV time-range wants UTC compact form: YYYYMMDDTHHMMSSZ
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function parseIcalDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value !== null && 'toJSDate' in value) {
    try {
      return (value as { toJSDate: () => Date }).toJSDate();
    } catch {
      return null;
    }
  }
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseLocalDateInput(value);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function parseVEventData(
  data: string,
  calendarUrl: string,
  color?: string
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  try {
    const jcalData = ICAL.parse(data);
    const comp = new ICAL.Component(jcalData);
    const vevents = comp.getAllSubcomponents('vevent');
    for (const vevent of vevents) {
      const event = new ICAL.Event(vevent);
      const summaryValue = vevent.getFirstPropertyValue('summary');
      const summary =
        typeof summaryValue === 'string' && summaryValue.trim()
          ? summaryValue
          : '(No title)';
      const descriptionValue = vevent.getFirstPropertyValue('description');
      const description =
        typeof descriptionValue === 'string' ? descriptionValue : undefined;
      const uidValue = vevent.getFirstPropertyValue('uid');
      const uid =
        typeof uidValue === 'string' && uidValue.trim()
          ? uidValue.trim()
          : `anon-${Math.random().toString(36).slice(2)}`;

      // Skip Cadence-managed events when reading (they come from local state).
      const cadenceId = vevent.getFirstPropertyValue(CADENCE_X_PROP);
      if (typeof cadenceId === 'string' && cadenceId.trim()) {
        continue;
      }

      const start = parseIcalDate(event.startDate) ?? new Date();
      const end = parseIcalDate(event.endDate) ?? new Date(start.getTime() + 60 * 60 * 1000);
      const calKey = Buffer.from(calendarUrl).toString('base64url').slice(0, 24);
      events.push({
        id: `apple-${calKey}-${uid}`,
        title: summary,
        description,
        start,
        end,
        isScheduled: false,
        color: colorForCalendarUrl(calendarUrl, color),
      });
    }
  } catch (error) {
    console.warn('Failed to parse Apple CalDAV object', error);
  }
  return events;
}

export function extractCadenceIdFromIcs(data: string): string | null {
  try {
    const jcalData = ICAL.parse(data);
    const comp = new ICAL.Component(jcalData);
    const vevent = comp.getFirstSubcomponent('vevent');
    if (!vevent) return null;
    const cadenceId = vevent.getFirstPropertyValue(CADENCE_X_PROP);
    if (typeof cadenceId === 'string' && cadenceId.trim()) return cadenceId.trim();
    // Fallback: UID cadence-{id}@…
    const uid = vevent.getFirstPropertyValue('uid');
    if (typeof uid === 'string') {
      const m = /^cadence-(.+)@bridgerscadence\.com$/i.exec(uid.trim());
      if (m?.[1]) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchAppleCalendarEvents(
  creds: { appleId: string; appSpecificPassword: string },
  options?: {
    timeMin?: Date;
    timeMax?: Date;
    calendarUrls?: string[];
    colorsByCalendarUrl?: Record<string, string>;
  }
): Promise<CalendarEvent[]> {
  const client = await createAppleDavSession(creds);
  const calendars = await client.fetchCalendars();
  const wanted = options?.calendarUrls;
  const selected =
    wanted && wanted.length > 0
      ? calendars.filter((c) => wanted.includes(c.url))
      : calendars;

  const now = new Date();
  const timeMin = options?.timeMin ?? now;
  const timeMax =
    options?.timeMax ??
    new Date(now.getTime() + SCHEDULE_MAX_HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const timeRange = {
    start: formatCalDavTimeRange(timeMin),
    end: formatCalDavTimeRange(timeMax),
  };

  const out: CalendarEvent[] = [];
  for (const calendar of selected) {
    try {
      const objects = await client.fetchCalendarObjects({
        calendar,
        timeRange,
      });
      const color = options?.colorsByCalendarUrl?.[calendar.url];
      for (const obj of objects) {
        const data = typeof obj.data === 'string' ? obj.data : undefined;
        if (!data) continue;
        out.push(...parseVEventData(data, calendar.url, color));
      }
    } catch (error) {
      if (isAuthFailure(error)) {
        throw new AppleAuthError(
          'Apple Calendar session expired or app-specific password was revoked.'
        );
      }
      console.warn('Failed to fetch Apple calendar objects', calendar.url, error);
    }
  }
  return out;
}

export function buildCadenceVEventIcs(row: {
  id: string;
  title: string;
  description?: string;
  start: string;
  end: string;
}): string {
  const uid = `cadence-${row.id}@bridgerscadence.com`;
  const dtStamp = formatCalDavTimeRange(new Date());
  const dtStart = formatCalDavTimeRange(new Date(row.start));
  const dtEnd = formatCalDavTimeRange(new Date(row.end));
  const escapeText = (s: string) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,');

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cadence//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeText(row.title)}`,
  ];
  if (row.description) {
    lines.push(`DESCRIPTION:${escapeText(row.description)}`);
  }
  lines.push(`${CADENCE_X_PROP.toUpperCase()}:${escapeText(row.id)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

export function cadenceObjectFilename(cadenceEventId: string): string {
  const safe = cadenceEventId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return `cadence-${safe}.ics`;
}

export async function findOrCreateCadenceCalendar(
  client: AppleDavSession,
  knownCalendarUrl?: string
): Promise<DAVCalendar> {
  const calendars = await client.fetchCalendars();
  if (knownCalendarUrl) {
    const known = calendars.find((c) => c.url === knownCalendarUrl);
    if (known) return known;
  }

  const existing = calendars.find(
    (c) => displayNameOf(c).toLowerCase() === CADENCE_CALENDAR_SUMMARY.toLowerCase()
  );
  if (existing) return existing;

  // Derive a sibling URL under calendar-home for MKCALENDAR.
  const homeUrl =
    calendars[0]?.url?.replace(/\/[^/]+\/?$/, '/') ??
    `${ICLOUD_CALDAV_URL}/`;
  const newUrl = `${homeUrl.replace(/\/?$/, '/') }cadence/`;

  try {
    await client.makeCalendar({
      url: newUrl,
      props: {
        displayname: CADENCE_CALENDAR_SUMMARY,
        // Apple / CalDAV display name
        '{DAV:}displayname': CADENCE_CALENDAR_SUMMARY,
      },
    });
  } catch (error) {
    // MKCALENDAR may fail on iCloud; fall through to re-list / pick writable.
    console.warn('MKCALENDAR Cadence failed; will try existing calendars', error);
  }

  const refreshed = await client.fetchCalendars();
  const created = refreshed.find(
    (c) =>
      c.url === newUrl ||
      displayNameOf(c).toLowerCase() === CADENCE_CALENDAR_SUMMARY.toLowerCase()
  );
  if (created) return created;

  // Fallback: first writable calendar that isn't a known read-only pattern.
  const fallback = refreshed[0];
  if (!fallback) {
    throw new Error('No writable Apple calendars found to sync Cadence events.');
  }
  return fallback;
}
