import { NextRequest, NextResponse } from 'next/server';
import { fetchGoogleCalendarEvents } from '@/lib/google-calendar';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const accessToken = searchParams.get('access_token');
  const timeMin = searchParams.get('timeMin');
  const timeMax = searchParams.get('timeMax');
  const calendarIdsParam = searchParams.get('calendarIds');
  const calendarIds = calendarIdsParam
    ? calendarIdsParam
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    : undefined;

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
      calendarIds
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
