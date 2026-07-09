import { NextRequest, NextResponse } from 'next/server';
import { getTokensFromCode } from '@/lib/google-calendar';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      new URL(`/?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/?error=missing_code', request.url)
    );
  }

  try {
    const tokens = await getTokensFromCode(code);
    
    // Store tokens in a temporary session/cookie or pass via query params
    // For simplicity, we'll pass via query params (in production, use secure cookies)
    const redirectUrl = new URL('/', request.url);
    if (tokens.access_token) {
      redirectUrl.searchParams.set('access_token', tokens.access_token);
    }
    if (tokens.refresh_token) {
      redirectUrl.searchParams.set('refresh_token', tokens.refresh_token);
    }
    
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    const googleError =
      error &&
      typeof error === 'object' &&
      'response' in error &&
      error.response &&
      typeof error.response === 'object' &&
      'data' in error.response
        ? (error.response as { data?: { error?: string; error_description?: string } })
            .data
        : undefined;
    if (googleError?.error === 'invalid_client') {
      console.error(
        'Google OAuth invalid_client:',
        googleError.error_description ?? 'check GOOGLE_CLIENT_SECRET'
      );
    } else {
      console.error('Error exchanging code for tokens:', error);
    }
    return NextResponse.redirect(
      new URL('/?error=auth_failed', request.url)
    );
  }
}

