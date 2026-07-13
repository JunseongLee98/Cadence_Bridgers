import { NextRequest, NextResponse } from 'next/server';
import { deleteAppleCredentials } from '@/lib/apple-credentials-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const connectionToken =
      typeof body.connectionToken === 'string' ? body.connectionToken.trim() : '';

    if (!connectionToken) {
      return NextResponse.json({ error: 'connectionToken required' }, { status: 400 });
    }

    await deleteAppleCredentials(connectionToken);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('apple disconnect:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to disconnect Apple Calendar.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
