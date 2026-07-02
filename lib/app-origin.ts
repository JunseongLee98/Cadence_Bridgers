import type { NextRequest } from 'next/server';

/** Public site URL for links in emails (verification, etc.). */
export function getAppOrigin(request?: NextRequest): string {
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    process.env.VERCEL_URL;
  if (env) {
    const trimmed = env.replace(/\/$/, '');
    if (trimmed.startsWith('http')) return trimmed;
    return `https://${trimmed}`;
  }
  if (request) {
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
    const proto = request.headers.get('x-forwarded-proto') || 'http';
    if (host) return `${proto}://${host}`;
  }
  return 'http://localhost:3000';
}
