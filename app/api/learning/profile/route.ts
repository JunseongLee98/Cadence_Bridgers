import { NextRequest, NextResponse } from 'next/server';
import { bearerAccessToken, fetchGoogleUserInfo } from '@/lib/google-userinfo';
import { deleteLearningProfile, getOrCreateLearningProfile } from '@/lib/learning-profile-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/learning/profile
 * Authorization: Bearer <Google access_token>
 */
export async function GET(request: NextRequest) {
  try {
    const accessToken = bearerAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: 'Missing Bearer access token' }, { status: 401 });
    }

    const user = await fetchGoogleUserInfo(accessToken);
    const profile = await getOrCreateLearningProfile(user.sub, {
      email: user.email,
      displayName: user.name,
    });

    return NextResponse.json({
      googleSub: profile.googleSub,
      email: profile.email,
      displayName: profile.displayName,
      calibrationByUnit: profile.calibrationByUnit,
      sampleCountByUnit: profile.sampleCountByUnit,
      updatedAt: profile.updatedAt,
    });
  } catch (error) {
    console.error('learning profile GET:', error);
    const message = error instanceof Error ? error.message : 'Failed to load profile';
    const status = message.includes('userinfo') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * DELETE /api/learning/profile
 * Authorization: Bearer <Google access_token>
 * Permanently deletes the caller's stored learning profile (Google sub, email,
 * display name, and timing calibration history).
 */
export async function DELETE(request: NextRequest) {
  try {
    const accessToken = bearerAccessToken(request);
    if (!accessToken) {
      return NextResponse.json({ error: 'Missing Bearer access token' }, { status: 401 });
    }

    const user = await fetchGoogleUserInfo(accessToken);
    await deleteLearningProfile(user.sub);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('learning profile DELETE:', error);
    const message = error instanceof Error ? error.message : 'Failed to delete profile';
    const status = message.includes('userinfo') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
