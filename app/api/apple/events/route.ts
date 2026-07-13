import { NextRequest, NextResponse } from 'next/server';
import { getAppleCredentials } from '@/lib/apple-credentials-store';
import { AppleAuthError, fetchAppleCalendarEvents } from '@/lib/apple-caldav';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const connectionToken = searchParams.get('connectionToken')?.trim();
  const timeMin = searchParams.get('timeMin');
  const timeMax = searchParams.get('timeMax');
  const calendarUrlsParam = searchParams.get('calendarUrls');
  const calendarUrls =
    calendarUrlsParam === null
      ? undefined
      : calendarUrlsParam
          .split(',')
          .map((u) => u.trim())
          .filter(Boolean);

  let colorsByCalendarUrl: Record<string, string> | undefined;
  const colorsParam = searchParams.get('calendarColors');
  if (colorsParam) {
    try {
      const parsed = JSON.parse(colorsParam) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        colorsByCalendarUrl = {};
        for (const [id, color] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof color === 'string' && color.trim()) {
            colorsByCalendarUrl[id] = color.trim();
          }
        }
      }
    } catch {
      colorsByCalendarUrl = undefined;
    }
  }

  if (!connectionToken) {
    return NextResponse.json({ error: 'connectionToken required' }, { status: 400 });
  }

  try {
    const creds = await getAppleCredentials(connectionToken);
    if (!creds) {
      return NextResponse.json(
        { error: 'Apple Calendar not connected. Reconnect with an app-specific password.' },
        { status: 401 }
      );
    }

    const events = await fetchAppleCalendarEvents(creds, {
      timeMin: timeMin ? new Date(timeMin) : undefined,
      timeMax: timeMax ? new Date(timeMax) : undefined,
      calendarUrls,
      colorsByCalendarUrl,
    });

    return NextResponse.json({ events });
  } catch (error) {
    console.error('apple events:', error);
    if (error instanceof AppleAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : 'Failed to fetch Apple calendar events.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
