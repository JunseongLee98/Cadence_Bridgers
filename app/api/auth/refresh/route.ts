import { NextRequest, NextResponse } from 'next/server';
import { refreshGoogleAccessToken } from '@/lib/google-calendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const refreshToken =
      typeof body.refreshToken === 'string' ? body.refreshToken.trim() : '';
    if (!refreshToken) {
      return NextResponse.json({ error: 'refreshToken required' }, { status: 400 });
    }
    const accessToken = await refreshGoogleAccessToken(refreshToken);
    return NextResponse.json({ accessToken });
  } catch (error) {
    console.error('auth refresh:', error);
    const message = error instanceof Error ? error.message : 'Failed to refresh token';
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
