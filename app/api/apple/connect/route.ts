import { NextRequest, NextResponse } from 'next/server';
import {
  createAppleConnectionToken,
  saveAppleCredentials,
} from '@/lib/apple-credentials-store';
import { AppleAuthError, listAppleCalendars } from '@/lib/apple-caldav';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const appleId = typeof body.appleId === 'string' ? body.appleId.trim() : '';
    const appSpecificPassword =
      typeof body.appSpecificPassword === 'string'
        ? body.appSpecificPassword.trim()
        : '';

    if (!appleId || !appSpecificPassword) {
      return NextResponse.json(
        { error: 'Apple ID and app-specific password are required.' },
        { status: 400 }
      );
    }

    // Validate credentials against iCloud CalDAV before storing.
    const calendars = await listAppleCalendars({ appleId, appSpecificPassword });

    const connectionToken = createAppleConnectionToken();
    await saveAppleCredentials(connectionToken, { appleId, appSpecificPassword });

    return NextResponse.json({
      connectionToken,
      calendars,
    });
  } catch (error) {
    console.error('apple connect:', error);
    if (error instanceof AppleAuthError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    const message =
      error instanceof Error ? error.message : 'Failed to connect Apple Calendar.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
