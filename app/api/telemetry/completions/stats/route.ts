import { NextRequest, NextResponse } from 'next/server';
import {
  aggregateWorkUnitStats,
  listCompletionTelemetry,
} from '@/lib/completion-telemetry-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorize(request: NextRequest): boolean {
  const secret = process.env.TELEMETRY_STATS_SECRET;
  if (!secret) return false;
  const header = request.headers.get('x-telemetry-stats-secret');
  const query = request.nextUrl.searchParams.get('secret');
  return header === secret || query === secret;
}

/**
 * GET /api/telemetry/completions/stats
 * Requires TELEMETRY_STATS_SECRET via header `x-telemetry-stats-secret` or `?secret=`.
 */
export async function GET(request: NextRequest) {
  try {
    if (!process.env.TELEMETRY_STATS_SECRET) {
      return NextResponse.json(
        { error: 'TELEMETRY_STATS_SECRET is not configured' },
        { status: 503 }
      );
    }
    if (!authorize(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const records = await listCompletionTelemetry();
    const byWorkUnit = aggregateWorkUnitStats(records);
    return NextResponse.json({
      totalRecords: records.length,
      recordsWithWorkUnits: byWorkUnit.reduce((sum, s) => sum + s.sampleCount, 0),
      byWorkUnit,
    });
  } catch (error) {
    console.error('telemetry completions stats:', error);
    const message = error instanceof Error ? error.message : 'Failed to load stats';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
