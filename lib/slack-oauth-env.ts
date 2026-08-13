const DEFAULT_REDIRECT_URI = 'http://localhost:3000/api/slack/callback';

export function getSlackOAuthEnv() {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.SLACK_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;

  return { clientId, clientSecret, redirectUri };
}

export function assertSlackOAuthEnv() {
  const { clientId, clientSecret, redirectUri } = getSlackOAuthEnv();
  if (!clientId || !clientSecret) {
    throw new Error('Slack credentials not configured');
  }
  return { clientId, clientSecret, redirectUri };
}
