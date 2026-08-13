import { createHmac, timingSafeEqual } from 'crypto';
import { assertSlackOAuthEnv } from '@/lib/slack-oauth-env';

/** Bot scopes for digest/reminder DMs. Status sync uses user_scope instead. */
export const SLACK_BOT_SCOPES = ['chat:write', 'im:write'] as const;
export const SLACK_USER_SCOPES = ['users.profile:write'] as const;

export type SlackOAuthState = {
  googleSub: string;
  feedToken?: string;
  timeZone?: string;
};

export type SlackOAuthTokens = {
  teamId: string;
  teamName?: string;
  slackUserId: string;
  accessToken: string;
  botAccessToken?: string;
};

type SlackApiError = Error & { slackError?: string };

function slackError(message: string, slackErr?: string): SlackApiError {
  const err = new Error(message) as SlackApiError;
  if (slackErr) err.slackError = slackErr;
  return err;
}

function signStateBody(body: string, clientSecret: string): string {
  return createHmac('sha256', clientSecret).update(body).digest('base64url');
}

export function encodeSlackOAuthState(
  payload: SlackOAuthState,
  clientSecret: string
): string {
  const body = Buffer.from(
    JSON.stringify({ ...payload, ts: Date.now() }),
    'utf8'
  ).toString('base64url');
  return `${body}.${signStateBody(body, clientSecret)}`;
}

export function decodeSlackOAuthState(
  state: string,
  clientSecret: string,
  maxAgeMs = 15 * 60 * 1000
): SlackOAuthState {
  const dot = state.lastIndexOf('.');
  if (dot <= 0) throw new Error('Invalid Slack OAuth state');
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);
  const expected = signStateBody(body, clientSecret);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Invalid Slack OAuth state signature');
  }
    let parsed: {
      googleSub?: unknown;
      feedToken?: unknown;
      timeZone?: unknown;
      ts?: unknown;
    };
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Invalid Slack OAuth state payload');
  }
  if (typeof parsed.googleSub !== 'string' || !parsed.googleSub.trim()) {
    throw new Error('Slack OAuth state missing googleSub');
  }
  if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > maxAgeMs) {
    throw new Error('Slack OAuth state expired');
  }
  return {
    googleSub: parsed.googleSub.trim(),
    ...(typeof parsed.feedToken === 'string' && parsed.feedToken.trim()
      ? { feedToken: parsed.feedToken.trim() }
      : {}),
    ...(typeof parsed.timeZone === 'string' && parsed.timeZone.trim()
      ? { timeZone: parsed.timeZone.trim() }
      : {}),
  };
}

export function getSlackAuthUrl(state: string): string {
  const { clientId, redirectUri } = assertSlackOAuthEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    user_scope: SLACK_USER_SCOPES.join(','),
    scope: SLACK_BOT_SCOPES.join(','),
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export async function getSlackTokensFromCode(code: string): Promise<SlackOAuthTokens> {
  const { clientId, clientSecret, redirectUri } = assertSlackOAuthEnv();
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = (await res.json()) as {
    ok?: boolean;
    error?: string;
    access_token?: string;
    team?: { id?: string; name?: string };
    authed_user?: { id?: string; access_token?: string };
  };

  if (!res.ok || !data.ok) {
    throw slackError(
      `Failed to exchange Slack code: ${data.error || res.statusText}`,
      data.error
    );
  }

  const slackUserId = data.authed_user?.id;
  const accessToken = data.authed_user?.access_token;
  const teamId = data.team?.id;
  if (!slackUserId || !accessToken || !teamId) {
    throw new Error('Slack OAuth response missing user token or team');
  }

  return {
    teamId,
    ...(typeof data.team?.name === 'string' ? { teamName: data.team.name } : {}),
    slackUserId,
    accessToken,
    ...(typeof data.access_token === 'string' ? { botAccessToken: data.access_token } : {}),
  };
}

export function buildSlackStatusProfile(input: {
  text: string;
  emoji: string;
  expirationUnix: number;
}): { status_text: string; status_emoji: string; status_expiration: number } {
  return {
    status_text: input.text.slice(0, 100),
    status_emoji: input.emoji,
    status_expiration: input.expirationUnix,
  };
}

async function slackApiJson<T>(
  method: string,
  token: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { ok?: boolean; error?: string };
  if (!res.ok || !data.ok) {
    throw slackError(
      `Slack ${method} failed: ${data.error || res.statusText}`,
      data.error
    );
  }
  return data;
}

export async function setSlackStatus(
  userAccessToken: string,
  input: { text: string; emoji: string; expirationUnix: number }
): Promise<void> {
  await slackApiJson('users.profile.set', userAccessToken, {
    profile: buildSlackStatusProfile(input),
  });
}

export async function clearSlackStatus(userAccessToken: string): Promise<void> {
  await slackApiJson('users.profile.set', userAccessToken, {
    profile: buildSlackStatusProfile({
      text: '',
      emoji: '',
      expirationUnix: 0,
    }),
  });
}

export async function postSlackDirectMessage(
  botAccessToken: string,
  slackUserId: string,
  text: string
): Promise<void> {
  const opened = await slackApiJson<{ channel?: { id?: string } }>(
    'conversations.open',
    botAccessToken,
    { users: slackUserId }
  );
  const channel = opened.channel?.id;
  if (!channel) {
    throw new Error('Slack conversations.open did not return a channel');
  }
  await slackApiJson('chat.postMessage', botAccessToken, { channel, text });
}
