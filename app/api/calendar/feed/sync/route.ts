import { NextRequest, NextResponse } from 'next/server';
import type { SerializedFeedEvent } from '@/lib/calendar-feed-events';
import { saveCalendarFeed, deleteCalendarFeed } from '@/lib/calendar-feed-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    if (!TOKEN_RE.test(token)) {
      return NextResponse.json(
        { error: 'Invalid feed token.' },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const events = parseEvents(body.events);
    const username = typeof body.username === 'string' ? body.username.trim() : undefined;
    const revokeToken =
      typeof body.revokeToken === 'string' && TOKEN_RE.test(body.revokeToken.trim())
        ? body.revokeToken.trim()
        : undefined;

    if (revokeToken && revokeToken !== token) {
      await deleteCalendarFeed(revokeToken);
    }

    await saveCalendarFeed({
      token,
      username,
      updatedAt: new Date().toISOString(),
      events,
    });

    return NextResponse.json(
      { ok: true, eventCount: events.length },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error('calendar feed sync:', error);
    const message =
      error instanceof Error && error.message.includes('BLOB')
        ? 'Calendar feed storage is not configured on the server.'
        : 'Failed to sync calendar feed.';
    return NextResponse.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
}
