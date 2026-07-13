import { NextRequest, NextResponse } from 'next/server';
import { getAppleCredentials } from '@/lib/apple-credentials-store';
import { AppleAuthError, listAppleCalendars } from '@/lib/apple-caldav';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const connectionToken = request.nextUrl.searchParams.get('connectionToken')?.trim();

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

    const calendars = await listAppleCalendars(creds);
    return NextResponse.json({ calendars });
  } catch (error) {
    console.error('apple calendars:', error);
    if (error instanceof AppleAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : 'Failed to list Apple calendars.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
