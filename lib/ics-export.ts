import type { CalendarEvent } from '@/types';
import type { SerializedFeedEvent, FeedTombstone } from '@/lib/calendar-feed-events';
import { FEED_ICS_REFRESH_INTERVAL } from '@/lib/feed-ics-constants';

function formatIcsUtc(date: Date): string {
  const iso = date.toISOString();
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\n');
}

function foldLine(line: string): string {
  const max = 75;
  if (line.length <= max) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, max));
  rest = rest.slice(max);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, max - 1)}`);
    rest = rest.slice(max - 1);
  }
  return parts.join('\r\n');
}

function calendarHeader(calendarName: string, productId: string): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    foldLine(`PRODID:${productId}`),
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldLine(`X-WR-CALNAME:${escapeIcsText(calendarName)}`),
    'X-WR-TIMEZONE:UTC',
    foldLine(`REFRESH-INTERVAL;VALUE=DURATION:${FEED_ICS_REFRESH_INTERVAL}`),
    foldLine(`X-PUBLISHED-TTL:${FEED_ICS_REFRESH_INTERVAL}`),
  ].join('\r\n');
}

function serializedRowToVevent(row: SerializedFeedEvent, publishedAt: Date): string {
  const uid = `cadence-${row.id}@cadence.app`;
  const start = new Date(row.start);
  const end = new Date(row.end);
  if (end.getTime() <= start.getTime()) return '';

  const lines = [
    'BEGIN:VEVENT',
    foldLine(`UID:${uid}`),
    foldLine(`DTSTAMP:${formatIcsUtc(publishedAt)}`),
    foldLine(`DTSTART:${formatIcsUtc(start)}`),
    foldLine(`DTEND:${formatIcsUtc(end)}`),
    foldLine(`SUMMARY:${escapeIcsText(row.title)}`),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    foldLine(`SEQUENCE:${row.sequence ?? 0}`),
  ];
  if (row.description) {
    lines.push(foldLine(`DESCRIPTION:${escapeIcsText(row.description)}`));
  }
  if (row.taskId) {
    lines.push(foldLine(`CATEGORIES:Cadence,Task`));
    lines.push(foldLine(`X-CADENCE-TASK-ID:${escapeIcsText(row.taskId)}`));
  } else {
    lines.push(foldLine(`CATEGORIES:Cadence`));
  }
  lines.push(foldLine(`X-CADENCE-EVENT-ID:${escapeIcsText(row.id)}`));
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

function tombstoneToVevent(tomb: FeedTombstone, publishedAt: Date): string {
  const uid = `cadence-${tomb.id}@cadence.app`;
  const start = new Date(tomb.start);
  const end = new Date(tomb.end);
  const safeEnd = end.getTime() > start.getTime() ? end : new Date(start.getTime() + 60 * 1000);

  const lines = [
    'BEGIN:VEVENT',
    foldLine(`UID:${uid}`),
    foldLine(`DTSTAMP:${formatIcsUtc(publishedAt)}`),
    foldLine(`DTSTART:${formatIcsUtc(start)}`),
    foldLine(`DTEND:${formatIcsUtc(safeEnd)}`),
    foldLine(`SUMMARY:${escapeIcsText(tomb.title)}`),
    'STATUS:CANCELLED',
    'TRANSP:TRANSPARENT',
    foldLine(`SEQUENCE:${tomb.sequence}`),
  ];
  lines.push(foldLine(`X-CADENCE-EVENT-ID:${escapeIcsText(tomb.id)}`));
  if (tomb.taskId) {
    lines.push(foldLine(`X-CADENCE-TASK-ID:${escapeIcsText(tomb.taskId)}`));
  }
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

function eventToVevent(event: CalendarEvent, publishedAt: Date, sequence = 0): string {
  const uid = `cadence-${event.id}@cadence.app`;
  const lines = [
    'BEGIN:VEVENT',
    foldLine(`UID:${uid}`),
    foldLine(`DTSTAMP:${formatIcsUtc(publishedAt)}`),
    foldLine(`DTSTART:${formatIcsUtc(event.start)}`),
    foldLine(`DTEND:${formatIcsUtc(event.end)}`),
    foldLine(`SUMMARY:${escapeIcsText(event.title)}`),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    foldLine(`SEQUENCE:${sequence}`),
  ];
  if (event.description) {
    lines.push(foldLine(`DESCRIPTION:${escapeIcsText(event.description)}`));
  }
  if (event.taskId) {
    lines.push(foldLine(`CATEGORIES:Cadence,Task`));
  } else {
    lines.push(foldLine(`CATEGORIES:Cadence`));
  }
  lines.push(foldLine(`X-CADENCE-EVENT-ID:${escapeIcsText(event.id)}`));
  if (event.taskId) {
    lines.push(foldLine(`X-CADENCE-TASK-ID:${escapeIcsText(event.taskId)}`));
  }
  lines.push('END:VEVENT');
  return lines.join('\r\n');
}

/** Build ICS from stored feed rows (includes SEQUENCE for subscription clients). */
export function buildIcsCalendarFromFeedRows(
  rows: SerializedFeedEvent[],
  options?: {
    calendarName?: string;
    productId?: string;
    publishedAt?: Date;
    tombstones?: FeedTombstone[];
  }
): string {
  const calendarName = options?.calendarName ?? 'Cadence Schedule';
  const productId = options?.productId ?? '-//Cadence//Cadence Calendar Feed//EN';
  const publishedAt = options?.publishedAt ?? new Date();
  const header = calendarHeader(calendarName, productId);

  const activeVevents = rows
    .map((row) => serializedRowToVevent(row, publishedAt))
    .filter(Boolean)
    .sort((a, b) => {
      const startA = a.match(/DTSTART:(\d+Z)/)?.[1] ?? '';
      const startB = b.match(/DTSTART:(\d+Z)/)?.[1] ?? '';
      return startA.localeCompare(startB);
    });

  const cancelledVevents = (options?.tombstones ?? []).map((t) =>
    tombstoneToVevent(t, publishedAt)
  );

  const body = [...activeVevents, ...cancelledVevents].filter(Boolean).join('\r\n');

  return `${header}\r\n${body}\r\nEND:VCALENDAR\r\n`;
}

export function buildIcsCalendar(
  events: CalendarEvent[],
  options?: { calendarName?: string; productId?: string; publishedAt?: Date }
): string {
  const calendarName = options?.calendarName ?? 'Cadence Schedule';
  const productId = options?.productId ?? '-//Cadence//Cadence Calendar Feed//EN';
  const publishedAt = options?.publishedAt ?? new Date();
  const header = calendarHeader(calendarName, productId);

  const body = events
    .filter((e) => e.end.getTime() > e.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((e) => eventToVevent(e, publishedAt))
    .join('\r\n');

  return `${header}\r\n${body}\r\nEND:VCALENDAR\r\n`;
}
