import { NextRequest, NextResponse } from 'next/server';
import {
  applyRatioToCalibrationMap,
  estimateActualRatio,
} from '@/lib/estimate-calibration';
import { normalizeWorkUnit } from '@/lib/decompose-assignment';
import { bearerAccessToken, fetchGoogleUserInfo } from '@/lib/google-userinfo';
import {
  getOrCreateLearningProfile,
  saveLearningProfile,
} from '@/lib/learning-profile-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/learning/calibration
 * Authorization: Bearer <Google access_token>
 * Body: { actualMinutes, estimatedMinutes, workUnit? }
 *
 * When |actual/estimate - 1| is large, slightly updates per-unit calibration for this Google user.
 */
export async function POST(request: NextRequest) {
  try {
    const accessToken = bearerAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: 'Missing Bearer access token' }, { status: 401 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const actualMinutes =
      typeof body.actualMinutes === 'number' ? body.actualMinutes : undefined;
    const estimatedMinutes =
      typeof body.estimatedMinutes === 'number' ? body.estimatedMinutes : undefined;
    if (actualMinutes === undefined || estimatedMinutes === undefined) {
      return NextResponse.json(
        { error: 'actualMinutes and estimatedMinutes are required' },
        { status: 400 }
      );
    }
    if (actualMinutes < 0 || actualMinutes > 24 * 60 || estimatedMinutes <= 0) {
      return NextResponse.json({ error: 'duration out of range' }, { status: 400 });
    }

    const ratio = estimateActualRatio(actualMinutes, estimatedMinutes);
    if (ratio === undefined) {
      return NextResponse.json({ error: 'invalid ratio' }, { status: 400 });
    }

    const user = await fetchGoogleUserInfo(accessToken);
    const profile = await getOrCreateLearningProfile(user.sub, {
      email: user.email,
      displayName: user.name,
    });

    const workUnit = normalizeWorkUnit(body.workUnit);
    const { next, unit, updated } = applyRatioToCalibrationMap(
      profile.calibrationByUnit,
      workUnit,
      ratio
    );

    if (!updated || !unit) {
      return NextResponse.json({
        ok: true,
        updated: false,
        ratio,
        calibrationByUnit: profile.calibrationByUnit,
        sampleCountByUnit: profile.sampleCountByUnit,
      });
    }

    const sampleCountByUnit = {
      ...profile.sampleCountByUnit,
      [unit]: (profile.sampleCountByUnit[unit] ?? 0) + 1,
    };

    const saved = {
      ...profile,
      calibrationByUnit: next,
      sampleCountByUnit,
      updatedAt: new Date().toISOString(),
    };
    await saveLearningProfile(saved);

    return NextResponse.json({
      ok: true,
      updated: true,
      ratio,
      workUnit: unit,
      factor: next[unit],
      calibrationByUnit: next,
      sampleCountByUnit,
    });
  } catch (error) {
    console.error('learning calibration POST:', error);
    const message = error instanceof Error ? error.message : 'Failed to update calibration';
    const status = message.includes('userinfo') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
