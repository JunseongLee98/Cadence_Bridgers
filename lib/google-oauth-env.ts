import { google } from 'googleapis';

const DEFAULT_REDIRECT_URI = 'http://localhost:3000/api/auth/callback';

export function getGoogleOAuthEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;

  return { clientId, clientSecret, redirectUri };
}

export function assertGoogleOAuthEnv() {
  const { clientId, clientSecret } = getGoogleOAuthEnv();
  if (!clientId || !clientSecret) {
    throw new Error('Google credentials not configured');
  }
  return getGoogleOAuthEnv();
}

export function createGoogleOAuth2Client() {
  const { clientId, clientSecret, redirectUri } = assertGoogleOAuthEnv();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
