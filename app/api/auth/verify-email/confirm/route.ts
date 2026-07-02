import { NextRequest, NextResponse } from 'next/server';
import { parseEmailVerificationToken } from '@/lib/verification-token';
import { getAppOrigin } from '@/lib/app-origin';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.redirect(new URL('/login?error=missing_token', request.url));
  }

  const parsed = parseEmailVerificationToken(token);
  if (!parsed) {
    return NextResponse.redirect(new URL('/login?error=invalid_or_expired_token', request.url));
  }

  const origin = getAppOrigin(request);
  const redirectUrl = new URL('/', origin);
  redirectUrl.searchParams.set('email_verified', '1');
  redirectUrl.searchParams.set('verified_email', parsed.email);

  return NextResponse.redirect(redirectUrl);
}
