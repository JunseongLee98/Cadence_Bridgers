import crypto from 'crypto';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret =
    process.env.EMAIL_VERIFICATION_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    'cadence-dev-verification-secret';
  return secret;
}

export function createEmailVerificationToken(email: string, ttlMs = DEFAULT_TTL_MS): string {
  const payload = {
    email: email.trim().toLowerCase(),
    exp: Date.now() + ttlMs,
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function parseEmailVerificationToken(
  token: string
): { email: string } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as {
      email?: string;
      exp?: number;
    };
    if (!payload.email || typeof payload.exp !== 'number') return null;
    if (Date.now() > payload.exp) return null;
    return { email: payload.email };
  } catch {
    return null;
  }
}
