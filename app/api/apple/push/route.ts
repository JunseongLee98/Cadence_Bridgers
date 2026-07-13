import { NextRequest, NextResponse } from 'next/server';
import type { SerializedFeedEvent } from '@/lib/calendar-feed-events';
import { getAppleCredentials } from '@/lib/apple-credentials-store';
import { AppleAuthError } from '@/lib/apple-caldav';
import { syncEventsToApple } from '@/lib/apple-calendar-push';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function parseEvents(raw: unknown): SerializedFeedEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: SerializedFeedEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.title !== 'string') continue;
    if (typeof row.start !== 'string' || typeof row.end !== 'string') continue;
    out.push({
      id: row.id,
      title: row.title,
      description: typeof row.description === 'string' ? row.description : undefined,
      start: row.start,
      end: row.end,
      taskId: typeof row.taskId === 'string' ? row.taskId : undefined,
    });
  }
  return out;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const connectionToken =
      typeof body.connectionToken === 'string' ? body.connectionToken.trim() : '';
    const calendarUrl =
      typeof body.calendarUrl === 'string' ? body.calendarUrl.trim() : undefined;
    const events = parseEvents(body.events);

    if (!connectionToken) {
      return NextResponse.json({ error: 'Not connected to Apple Calendar.' }, { status: 401 });
    }

    const creds = await getAppleCredentials(connectionToken);
    if (!creds) {
      return NextResponse.json(
        { error: 'Apple Calendar not connected. Reconnect with an app-specific password.' },
        { status: 401 }
      );
    }

    const result = await syncEventsToApple(creds, events, calendarUrl || undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('apple calendar push:', error);
    const status = error instanceof AppleAuthError ? 401 : 500;
    const message =
      error instanceof Error ? error.message : 'Failed to push to Apple Calendar.';
    return NextResponse.json({ error: message }, { status });
  }
}
