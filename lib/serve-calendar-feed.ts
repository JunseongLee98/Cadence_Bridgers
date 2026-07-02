import { NextResponse } from 'next/server';
import { deserializeFeedEvents } from '@/lib/calendar-feed-events';
import { loadCalendarFeed } from '@/lib/calendar-feed-store';
import { buildIcsCalendar } from '@/lib/ics-export';

export function normalizeFeedToken(raw: string): string {
  return raw.replace(/\.ics$/i, '');
}

export async function serveCalendarFeedIcs(token: string): Promise<NextResponse> {
  const record = await loadCalendarFeed(token);
  if (!record) {
    return new NextResponse('Cadence calendar feed not found.', { status: 404 });
  }

  const events = deserializeFeedEvents(record.events);
  const calendarName = record.username
    ? `Cadence — ${record.username}`
    : 'Cadence Schedule';

  const ics = buildIcsCalendar(events, { calendarName });
  const updatedAt = record.updatedAt ? new Date(record.updatedAt) : new Date();
  const etag = `"cadence-feed-${token}-${record.events.length}-${updatedAt.getTime()}"`;

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      // inline helps Google Calendar URL subscriptions (attachment is for one-off downloads).
      'Content-Disposition': `inline; filename="cadence-${token.slice(0, 8)}.ics"`,
      'Cache-Control': 'public, max-age=300, must-revalidate',
      'Last-Modified': updatedAt.toUTCString(),
      ETag: etag,
    },
  });
}
