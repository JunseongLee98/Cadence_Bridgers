import { NextRequest, NextResponse } from 'next/server';
import type { SerializedFeedEvent } from '@/lib/calendar-feed-events';
import { syncEventsToGoogle, GoogleAuthError } from '@/lib/google-calendar-push';
import { refreshGoogleAccessToken } from '@/lib/google-calendar';

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
    const accessToken = typeof body.accessToken === 'string' ? body.accessToken : '';
    const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : '';
    const calendarId = typeof body.calendarId === 'string' ? body.calendarId : undefined;
    const events = parseEvents(body.events);

    if (!accessToken && !refreshToken) {
      return NextResponse.json({ error: 'Not connected to Google.' }, { status: 401 });
    }

    let token = accessToken;
    let refreshedAccessToken: string | undefined;

    const run = (t: string) => syncEventsToGoogle(t, events, calendarId);

    try {
      const result = await run(token);
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof GoogleAuthError && refreshToken) {
        token = await refreshGoogleAccessToken(refreshToken);
        refreshedAccessToken = token;
        const result = await run(token);
        return NextResponse.json({ ok: true, accessToken: refreshedAccessToken, ...result });
      }
      throw error;
    }
  } catch (error) {
    console.error('google calendar push:', error);
    const status = error instanceof GoogleAuthError ? 401 : 500;
    const message =
      error instanceof Error ? error.message : 'Failed to push to Google Calendar.';
    return NextResponse.json({ error: message }, { status });
  }
}
