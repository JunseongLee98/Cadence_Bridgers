import { NextRequest, NextResponse } from 'next/server';
import { fetchGoogleCalendarEvents } from '@/lib/google-calendar';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const accessToken = searchParams.get('access_token');
  const timeMin = searchParams.get('timeMin');
  const timeMax = searchParams.get('timeMax');
  const calendarIdsParam = searchParams.get('calendarIds');
  // null = omit (default primary); "" or list = explicit selection (possibly empty)
  const calendarIds =
    calendarIdsParam === null
      ? undefined
      : calendarIdsParam
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
  let colorsByCalendarId: Record<string, string> | undefined;
  const colorsParam = searchParams.get('calendarColors');
  if (colorsParam) {
    try {
      const parsed = JSON.parse(colorsParam) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        colorsByCalendarId = {};
        for (const [id, color] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof color === 'string' && color.trim()) {
            colorsByCalendarId[id] = color.trim();
          }
        }
      }
    } catch {
      colorsByCalendarId = undefined;
    }
  }

  if (!accessToken) {
    return NextResponse.json(
      { error: 'Access token required' },
      { status: 401 }
    );
  }

  try {
    const events = await fetchGoogleCalendarEvents(
      accessToken,
      timeMin ? new Date(timeMin) : undefined,
      timeMax ? new Date(timeMax) : undefined,
      calendarIds,
      colorsByCalendarId
    );

    return NextResponse.json({ events });
  } catch (error: any) {
    console.error('Error fetching events:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch calendar events' },
      { status: error.response?.status || error.status || 500 }
    );
  }
}
