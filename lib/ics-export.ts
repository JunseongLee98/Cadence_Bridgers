import type { CalendarEvent } from '@/types';

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

function eventToVevent(event: CalendarEvent, calendarName: string): string {
  const uid = `cadence-${event.id}@cadence.app`;
  const lines = [
    'BEGIN:VEVENT',
    foldLine(`UID:${uid}`),
    foldLine(`DTSTAMP:${formatIcsUtc(new Date())}`),
    foldLine(`DTSTART:${formatIcsUtc(event.start)}`),
    foldLine(`DTEND:${formatIcsUtc(event.end)}`),
    foldLine(`SUMMARY:${escapeIcsText(event.title)}`),
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

export function buildIcsCalendar(
  events: CalendarEvent[],
  options?: { calendarName?: string; productId?: string }
): string {
  const calendarName = options?.calendarName ?? 'Cadence Schedule';
  const productId = options?.productId ?? '-//Cadence//Cadence Calendar Feed//EN';
  const header = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    foldLine(`PRODID:${productId}`),
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    foldLine(`X-WR-CALNAME:${escapeIcsText(calendarName)}`),
  ].join('\r\n');

  const body = events
    .filter((e) => e.end.getTime() > e.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .map((e) => eventToVevent(e, calendarName))
    .join('\r\n');

  return `${header}\r\n${body}\r\nEND:VCALENDAR\r\n`;
}
