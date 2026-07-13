import { NextRequest, NextResponse } from 'next/server';
import { listGoogleCalendarsRest } from '@/lib/google-calendar-rest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const accessToken = request.nextUrl.searchParams.get('access_token');

  if (!accessToken) {
    return NextResponse.json({ error: 'Access token required' }, { status: 401 });
  }

  try {
    const calendars = await listGoogleCalendarsRest(accessToken);
    return NextResponse.json({ calendars });
  } catch (error: unknown) {
    console.error('Error listing Google calendars:', error);
    const err = error as { message?: string; status?: number };
    return NextResponse.json(
      { error: err.message || 'Failed to list calendars' },
      { status: err.status || 500 }
    );
  }
}
