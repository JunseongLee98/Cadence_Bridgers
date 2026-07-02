import type { NextRequest } from 'next/server';
import { normalizeFeedToken, serveCalendarFeedIcs } from '@/lib/serve-calendar-feed';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ token: string }> | { token: string } };

export async function GET(_request: NextRequest, context: RouteContext) {
  const params = await Promise.resolve(context.params);
  const token = normalizeFeedToken(params.token || '');
  return serveCalendarFeedIcs(token);
}
