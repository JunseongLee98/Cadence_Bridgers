import type { CalibrationByUnit } from '@/lib/estimate-calibration';
import { storage } from '@/lib/storage';

export type LearningProfileClient = {
  googleSub: string;
  email?: string;
  displayName?: string;
  calibrationByUnit: CalibrationByUnit;
  sampleCountByUnit: Record<string, number>;
  updatedAt: string;
};

/** Load server learning profile for the signed-in Google user. */
export async function fetchLearningProfile(
  accessToken: string
): Promise<LearningProfileClient | null> {
  const res = await fetch('/api/learning/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as LearningProfileClient;
  if (data.calibrationByUnit) {
    storage.saveLocalCalibration(data.calibrationByUnit);
  }
  return data;
}

/** Push a completion gap into the per-Google-user calibration store. */
export async function postLearningCalibration(
  accessToken: string,
  body: {
    actualMinutes: number;
    estimatedMinutes: number;
    workUnit?: string;
  }
): Promise<CalibrationByUnit | null> {
  const res = await fetch('/api/learning/calibration', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    calibrationByUnit?: CalibrationByUnit;
  };
  if (data.calibrationByUnit) {
    storage.saveLocalCalibration(data.calibrationByUnit);
    return data.calibrationByUnit;
  }
  return null;
}
