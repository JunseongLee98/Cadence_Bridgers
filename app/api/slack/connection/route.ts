import { NextRequest, NextResponse } from 'next/server';
import {
  deleteSlackConnection,
  getSlackConnection,
  saveSlackConnection,
  toPublicSlackConnection,
} from '@/lib/slack-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function googleSubFrom(request: NextRequest, body?: Record<string, unknown>): string | null {
  const fromQuery = request.nextUrl.searchParams.get('googleSub')?.trim();
  if (fromQuery) return fromQuery;
  const fromBody = typeof body?.googleSub === 'string' ? body.googleSub.trim() : '';
  return fromBody || null;
}

export async function GET(request: NextRequest) {
  try {
    const googleSub = googleSubFrom(request);
    if (!googleSub) {
      return NextResponse.json({ error: 'googleSub required' }, { status: 400 });
    }
    const record = await getSlackConnection(googleSub);
    if (!record) {
      return NextResponse.json({ connected: false });
    }
    return NextResponse.json(toPublicSlackConnection(record));
  } catch (error) {
    console.error('slack connection GET:', error);
    const message = error instanceof Error ? error.message : 'Failed to load Slack connection';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const googleSub = googleSubFrom(request, body);
    if (!googleSub) {
      return NextResponse.json({ error: 'googleSub required' }, { status: 400 });
    }
    const existing = await getSlackConnection(googleSub);
    if (!existing) {
      return NextResponse.json({ error: 'Slack is not connected' }, { status: 404 });
    }

    const next = { ...existing };
    if (typeof body.statusSyncEnabled === 'boolean') {
      next.statusSyncEnabled = body.statusSyncEnabled;
    }
    if (typeof body.digestEnabled === 'boolean') {
      next.digestEnabled = body.digestEnabled;
    }
    if (body.reminderMinutesBefore === null) {
      delete next.reminderMinutesBefore;
    } else if (
      typeof body.reminderMinutesBefore === 'number' &&
      Number.isFinite(body.reminderMinutesBefore) &&
      body.reminderMinutesBefore > 0
    ) {
      next.reminderMinutesBefore = Math.round(body.reminderMinutesBefore);
    }
    if (typeof body.calendarFeedToken === 'string' && body.calendarFeedToken.trim()) {
      next.calendarFeedToken = body.calendarFeedToken.trim();
    }
    if (typeof body.timeZone === 'string' && body.timeZone.trim()) {
      next.timeZone = body.timeZone.trim();
    }

    await saveSlackConnection(next);
    const saved = (await getSlackConnection(googleSub)) ?? next;
    return NextResponse.json(toPublicSlackConnection(saved));
  } catch (error) {
    console.error('slack connection PATCH:', error);
    const message = error instanceof Error ? error.message : 'Failed to update Slack settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const googleSub = googleSubFrom(request, body);
    if (!googleSub) {
      return NextResponse.json({ error: 'googleSub required' }, { status: 400 });
    }
    await deleteSlackConnection(googleSub);
    return NextResponse.json({ connected: false });
  } catch (error) {
    console.error('slack connection DELETE:', error);
    const message = error instanceof Error ? error.message : 'Failed to disconnect Slack';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
