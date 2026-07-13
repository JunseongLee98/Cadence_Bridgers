/**
 * Resolve Google account identity from an OAuth access token (openid profile).
 */
export type GoogleUserInfo = {
  sub: string;
  email?: string;
  name?: string;
};

export async function fetchGoogleUserInfo(
  accessToken: string
): Promise<GoogleUserInfo> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch Google userinfo: ${text || res.statusText}`);
  }
  const data = (await res.json()) as {
    sub?: string;
    email?: string;
    name?: string;
  };
  if (!data.sub || typeof data.sub !== 'string') {
    throw new Error('Google userinfo missing sub');
  }
  return {
    sub: data.sub,
    ...(typeof data.email === 'string' ? { email: data.email } : {}),
    ...(typeof data.name === 'string' ? { name: data.name } : {}),
  };
}

/** Extract Bearer token from Authorization header. */
export function bearerAccessToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}
