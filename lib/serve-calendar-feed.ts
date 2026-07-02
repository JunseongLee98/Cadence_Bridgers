import { NextResponse } from 'next/server';
import { buildIcsCalendarFromFeedRows } from '@/lib/ics-export';
import { FEED_HTTP_MAX_AGE_SECONDS } from '@/lib/feed-ics-constants';
import { loadCalendarFeed } from '@/lib/calendar-feed-store';

export function normalizeFeedToken(raw: string): string {
  return raw.replace(/\.ics$/i, '');
}

export async function serveCalendarFeedIcs(token: string): Promise<NextResponse> {
  const record = await loadCalendarFeed(token);
  if (!record) {
    return new NextResponse('Cadence calendar feed not found.', { status: 404 });
  }

  const events = record.events;
  const calendarName = record.username
    ? `Cadence — ${record.username}`
    : 'Cadence Schedule';

  const tombstones = record.tombstones ?? [];
  const updatedAt = record.updatedAt ? new Date(record.updatedAt) : new Date();
  const ics = buildIcsCalendarFromFeedRows(events, {
    calendarName,
    publishedAt: updatedAt,
    tombstones,
  });
  const etag = `"cadence-feed-${token}-${events.length}-${tombstones.length}-${updatedAt.getTime()}"`;

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="cadence-${token.slice(0, 8)}.ics"`,
      'Cache-Control': `public, max-age=${FEED_HTTP_MAX_AGE_SECONDS}, must-revalidate`,
      'Last-Modified': updatedAt.toUTCString(),
      ETag: etag,
    },
  });
}
