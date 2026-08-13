import { google } from 'googleapis';

const DEFAULT_REDIRECT_URI = 'http://localhost:3000/api/auth/callback';

/**
 * Resolve the OAuth callback URL.
 *
 * Prefers the origin of the request that started the flow, so preview/branch
 * deployments complete OAuth on their own origin instead of bouncing the user
 * to the production deployment (which runs different code and a different
 * localStorage). Every origin used this way must still be registered as an
 * authorized redirect URI in the Google Cloud Console — unregistered origins
 * fail loudly with redirect_uri_mismatch rather than silently switching hosts.
 *
 * GOOGLE_REDIRECT_URI remains a fallback for contexts with no request origin
 * (and for proxy setups where the forwarded host is unreliable — unset it per
 * environment if origin derivation should always win).
 */
export function resolveGoogleRedirectUri(requestOrigin?: string): string {
  if (requestOrigin?.trim()) {
    return `${requestOrigin.trim().replace(/\/$/, '')}/api/auth/callback`;
  }
  return process.env.GOOGLE_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
}

export function getGoogleOAuthEnv(requestOrigin?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = resolveGoogleRedirectUri(requestOrigin);

  return { clientId, clientSecret, redirectUri };
}

export function assertGoogleOAuthEnv(requestOrigin?: string) {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthEnv(requestOrigin);
  if (!clientId || !clientSecret) {
    throw new Error('Google credentials not configured');
  }
  return { clientId, clientSecret, redirectUri };
}

export function createGoogleOAuth2Client(requestOrigin?: string) {
  const { clientId, clientSecret, redirectUri } = assertGoogleOAuthEnv(requestOrigin);
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
