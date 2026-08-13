import { NextRequest, NextResponse } from 'next/server';
import { encodeSlackOAuthState, getSlackAuthUrl } from '@/lib/slack-client';
import { getSlackOAuthEnv } from '@/lib/slack-oauth-env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { clientId, clientSecret } = getSlackOAuthEnv();
    if (!clientId || !clientSecret) {
      return NextResponse.json(
        { error: 'Slack credentials not configured' },
        { status: 500 }
      );
    }

    const googleSub = request.nextUrl.searchParams.get('googleSub')?.trim();
    if (!googleSub) {
      return NextResponse.json(
        { error: 'Connect Google Calendar first' },
        { status: 400 }
      );
    }

    const feedToken = request.nextUrl.searchParams.get('feedToken')?.trim();
    const timeZone = request.nextUrl.searchParams.get('timeZone')?.trim();
    const state = encodeSlackOAuthState(
      {
        googleSub,
        ...(feedToken ? { feedToken } : {}),
        ...(timeZone ? { timeZone } : {}),
      },
      clientSecret
    );
    const authUrl = getSlackAuthUrl(state);
    return NextResponse.json({ authUrl });
  } catch (error) {
    console.error('Error generating Slack auth URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate Slack auth URL' },
      { status: 500 }
    );
  }
}
