import { NextRequest, NextResponse } from 'next/server';
import {
  appendCompletionTelemetry,
  type CompletionDurationSource,
  type CompletionTelemetryRecord,
} from '@/lib/completion-telemetry-store';
import { sanitizeWorkFields } from '@/lib/decompose-assignment';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function asOptionalString(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

function asOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value;
}

function asDurationSource(value: unknown): CompletionDurationSource {
  if (value === 'scheduled_block' || value === 'estimate' || value === 'self_report') {
    return value;
  }
  return 'self_report';
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    const anonymousSessionId = asOptionalString(body.anonymousSessionId, 80);
    const actualMinutes = asOptionalNumber(body.actualMinutes);
    if (!anonymousSessionId || actualMinutes === undefined) {
      return NextResponse.json(
        { error: 'anonymousSessionId and actualMinutes are required' },
        { status: 400 }
      );
    }
    if (actualMinutes < 0 || actualMinutes > 24 * 60) {
      return NextResponse.json({ error: 'actualMinutes out of range' }, { status: 400 });
    }

    const planStepOrder = asOptionalNumber(body.planStepOrder);
    const estimatedMinutes = asOptionalNumber(body.estimatedMinutes);
    const planId = asOptionalString(body.planId, 80);
    const procedureTitle = asOptionalString(body.procedureTitle, 300);
    const procedureDescription = asOptionalString(body.procedureDescription, 2000);
    const completedAt =
      asOptionalString(body.completedAt, 40) || new Date().toISOString();
    const isAiBreakdown =
      body.isAiBreakdown === true ||
      Boolean(planId) ||
      planStepOrder !== undefined;
    const durationSource = asDurationSource(body.durationSource);
    const work = sanitizeWorkFields({
      workAmount: body.workAmount,
      workUnit: body.workUnit,
    });
    const schemaVersion = work.workAmount !== undefined ? 2 : 1;

    const record: CompletionTelemetryRecord = {
      schemaVersion,
      anonymousSessionId,
      isAiBreakdown,
      actualMinutes: Math.round(actualMinutes),
      durationSource,
      completedAt,
      receivedAt: new Date().toISOString(),
      ...(planId ? { planId } : {}),
      ...(planStepOrder !== undefined ? { planStepOrder: Math.round(planStepOrder) } : {}),
      ...(procedureTitle ? { procedureTitle } : {}),
      ...(procedureDescription ? { procedureDescription } : {}),
      ...(estimatedMinutes !== undefined
        ? { estimatedMinutes: Math.round(estimatedMinutes) }
        : {}),
      ...work,
    };

    await appendCompletionTelemetry(record);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('telemetry completions:', error);
    const message = error instanceof Error ? error.message : 'Failed to store telemetry';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
