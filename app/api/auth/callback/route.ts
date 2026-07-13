import { NextRequest, NextResponse } from 'next/server';
import { getTokensFromCode } from '@/lib/google-calendar';
import { fetchGoogleUserInfo } from '@/lib/google-userinfo';
import { getOrCreateLearningProfile } from '@/lib/learning-profile-store';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      new URL(`/app?error=${encodeURIComponent(error)}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/app?error=missing_code', request.url)
    );
  }

  try {
    const tokens = await getTokensFromCode(code);

    const redirectUrl = new URL('/app', request.url);
    if (tokens.access_token) {
      redirectUrl.searchParams.set('access_token', tokens.access_token);
    }
    if (tokens.refresh_token) {
      redirectUrl.searchParams.set('refresh_token', tokens.refresh_token);
    }

    if (tokens.access_token) {
      try {
        const user = await fetchGoogleUserInfo(tokens.access_token);
        redirectUrl.searchParams.set('google_sub', user.sub);
        if (user.email) redirectUrl.searchParams.set('google_email', user.email);
        if (user.name) redirectUrl.searchParams.set('google_name', user.name);
        await getOrCreateLearningProfile(user.sub, {
          email: user.email,
          displayName: user.name,
        });
      } catch (identityError) {
        console.warn('Google userinfo / learning profile bootstrap failed', identityError);
      }
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
      new URL('/app?error=auth_failed', request.url)
    );
  }
}
