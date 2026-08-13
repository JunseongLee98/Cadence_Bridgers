import { NextRequest, NextResponse } from 'next/server';
import { decodeSlackOAuthState, getSlackTokensFromCode } from '@/lib/slack-client';
import { getSlackOAuthEnv } from '@/lib/slack-oauth-env';
import { getSlackConnection, saveSlackConnection } from '@/lib/slack-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function redirectToApp(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/app', request.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const state = searchParams.get('state');

  if (error) {
    return redirectToApp(request, { slack_error: error });
  }

  if (!code || !state) {
    return redirectToApp(request, { slack_error: 'missing_code' });
  }

  const { clientSecret } = getSlackOAuthEnv();
  if (!clientSecret) {
    return redirectToApp(request, { slack_error: 'not_configured' });
  }

  try {
    const oauthState = decodeSlackOAuthState(state, clientSecret);
    const tokens = await getSlackTokensFromCode(code);
    const existing = await getSlackConnection(oauthState.googleSub);

    await saveSlackConnection({
      googleSub: oauthState.googleSub,
      teamId: tokens.teamId,
      ...(tokens.teamName ? { teamName: tokens.teamName } : {}),
      accessToken: tokens.accessToken,
      slackUserId: tokens.slackUserId,
      statusSyncEnabled: existing?.statusSyncEnabled ?? true,
      digestEnabled: existing?.digestEnabled ?? false,
      ...(typeof existing?.reminderMinutesBefore === 'number'
        ? { reminderMinutesBefore: existing.reminderMinutesBefore }
        : {}),
      ...(oauthState.feedToken
        ? { calendarFeedToken: oauthState.feedToken }
        : existing?.calendarFeedToken
          ? { calendarFeedToken: existing.calendarFeedToken }
          : {}),
      ...(tokens.botAccessToken ? { botAccessToken: tokens.botAccessToken } : {}),
      ...(oauthState.timeZone || existing?.timeZone
        ? { timeZone: oauthState.timeZone || existing?.timeZone }
        : {}),
      updatedAt: new Date().toISOString(),
      lastStatusEventId: existing?.lastStatusEventId ?? null,
      lastDigestDate: existing?.lastDigestDate ?? null,
      remindedEventIds: existing?.remindedEventIds ?? [],
    });

    return redirectToApp(request, { slack: 'connected' });
  } catch (err) {
    console.error('Error exchanging Slack code for tokens:', err);
    return redirectToApp(request, { slack_error: 'auth_failed' });
  }
}
