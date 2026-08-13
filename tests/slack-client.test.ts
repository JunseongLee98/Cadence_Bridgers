import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSlackStatusProfile,
  decodeSlackOAuthState,
  encodeSlackOAuthState,
  getSlackAuthUrl,
  getSlackTokensFromCode,
  SLACK_BOT_SCOPES,
  SLACK_USER_SCOPES,
} from '@/lib/slack-client';

describe('slack-client OAuth helpers', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('round-trips signed OAuth state', () => {
    const secret = 'test-secret';
    const encoded = encodeSlackOAuthState(
      { googleSub: 'google-123', feedToken: 'feed-abc', timeZone: 'America/New_York' },
      secret
    );
    expect(decodeSlackOAuthState(encoded, secret)).toEqual({
      googleSub: 'google-123',
      feedToken: 'feed-abc',
      timeZone: 'America/New_York',
    });
  });

  it('rejects a tampered OAuth state', () => {
    const secret = 'test-secret';
    const encoded = encodeSlackOAuthState({ googleSub: 'google-123' }, secret);
    const [body] = encoded.split('.');
    expect(() => decodeSlackOAuthState(`${body}.notasignature`, secret)).toThrow(
      /signature/
    );
  });

  it('builds authorize URL with user and bot scopes', () => {
    vi.stubEnv('SLACK_CLIENT_ID', 'cid');
    vi.stubEnv('SLACK_CLIENT_SECRET', 'csecret');
    vi.stubEnv('SLACK_REDIRECT_URI', 'http://localhost:3000/api/slack/callback');
    const url = new URL(getSlackAuthUrl('state-token'));
    expect(url.origin + url.pathname).toBe('https://slack.com/oauth/v2/authorize');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('user_scope')).toBe(SLACK_USER_SCOPES.join(','));
    expect(url.searchParams.get('scope')).toBe(SLACK_BOT_SCOPES.join(','));
    expect(url.searchParams.get('state')).toBe('state-token');
  });

  it('parses oauth.v2.access into user and bot tokens', async () => {
    vi.stubEnv('SLACK_CLIENT_ID', 'cid');
    vi.stubEnv('SLACK_CLIENT_SECRET', 'csecret');
    vi.stubEnv('SLACK_REDIRECT_URI', 'http://localhost:3000/api/slack/callback');
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        access_token: 'xoxb-bot',
        team: { id: 'T1', name: 'Cadence Dev' },
        authed_user: { id: 'U1', access_token: 'xoxp-user' },
      }),
    })) as unknown as typeof fetch;

    const tokens = await getSlackTokensFromCode('oauth-code');
    expect(tokens).toEqual({
      teamId: 'T1',
      teamName: 'Cadence Dev',
      slackUserId: 'U1',
      accessToken: 'xoxp-user',
      botAccessToken: 'xoxb-bot',
    });

    const [, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init as RequestInit).method).toBe('POST');
  });

  it('builds a truncated status profile for users.profile.set', () => {
    const long = 'x'.repeat(120);
    const profile = buildSlackStatusProfile({
      text: long,
      emoji: ':dart:',
      expirationUnix: 1_700_000_000,
    });
    expect(profile.status_text).toHaveLength(100);
    expect(profile.status_emoji).toBe(':dart:');
    expect(profile.status_expiration).toBe(1_700_000_000);
  });
});
