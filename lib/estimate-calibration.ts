import { normalizeWorkUnit } from '@/lib/decompose-assignment';

/** Relative gap |actual/estimate - 1| above this triggers a calibration update. */
export const CALIBRATION_GAP_THRESHOLD = 0.3;
/** EMA blend weight for new ratio observations. */
export const CALIBRATION_EMA_ALPHA = 0.2;
export const CALIBRATION_FACTOR_MIN = 0.7;
export const CALIBRATION_FACTOR_MAX = 1.4;

export type CalibrationByUnit = Record<string, number>;

export type LearningProfile = {
  googleSub: string;
  email?: string;
  displayName?: string;
  /** Multiplier applied to AI estimated minutes per work unit (1 = no change). */
  calibrationByUnit: CalibrationByUnit;
  sampleCountByUnit: Record<string, number>;
  updatedAt: string;
};

export function clampCalibrationFactor(factor: number): number {
  if (!Number.isFinite(factor)) return 1;
  return Math.min(CALIBRATION_FACTOR_MAX, Math.max(CALIBRATION_FACTOR_MIN, factor));
}

export function estimateActualRatio(
  actualMinutes: number,
  estimatedMinutes: number
): number | undefined {
  if (!(actualMinutes >= 0) || !(estimatedMinutes > 0)) return undefined;
  const ratio = actualMinutes / estimatedMinutes;
  if (!Number.isFinite(ratio) || ratio <= 0) return undefined;
  return ratio;
}

/** True when |ratio - 1| exceeds the configured gap threshold. */
export function shouldUpdateCalibration(ratio: number): boolean {
  if (!Number.isFinite(ratio) || ratio <= 0) return false;
  return Math.abs(ratio - 1) >= CALIBRATION_GAP_THRESHOLD;
}

/**
 * Slightly blend a new actual/estimate ratio into the current factor (EMA + clamp).
 */
export function updateCalibrationFactor(
  currentFactor: number | undefined,
  ratio: number
): number {
  const base = clampCalibrationFactor(currentFactor ?? 1);
  if (!shouldUpdateCalibration(ratio)) return base;
  const next = (1 - CALIBRATION_EMA_ALPHA) * base + CALIBRATION_EMA_ALPHA * ratio;
  return clampCalibrationFactor(next);
}

export function applyCalibration(
  estimatedMinutes: number,
  factor: number | undefined
): number {
  const minutes = Number.isFinite(estimatedMinutes) ? estimatedMinutes : 60;
  const f = clampCalibrationFactor(factor ?? 1);
  const adjusted = Math.round(minutes * f);
  return Math.min(Math.max(adjusted, 15), 60 * 24);
}

export function getUnitFactor(
  calibrationByUnit: CalibrationByUnit | undefined,
  workUnit: string | undefined
): number {
  const unit = normalizeWorkUnit(workUnit);
  if (!unit || !calibrationByUnit) return 1;
  return clampCalibrationFactor(calibrationByUnit[unit] ?? 1);
}

/** Apply per-unit calibration to a set of AI subtask estimates. */
export function calibrateSubtaskEstimates<
  T extends { estimatedMinutes?: number; workUnit?: string },
>(subtasks: T[], calibrationByUnit: CalibrationByUnit | undefined): T[] {
  if (!calibrationByUnit) return subtasks;
  return subtasks.map((st) => {
    if (st.estimatedMinutes === undefined) return st;
    const factor = getUnitFactor(calibrationByUnit, st.workUnit);
    if (factor === 1) return st;
    return {
      ...st,
      estimatedMinutes: applyCalibration(st.estimatedMinutes, factor),
    };
  });
}

export function applyRatioToCalibrationMap(
  current: CalibrationByUnit,
  workUnit: string | undefined,
  ratio: number
): { next: CalibrationByUnit; unit?: string; updated: boolean } {
  const unit = normalizeWorkUnit(workUnit);
  if (!unit || !shouldUpdateCalibration(ratio)) {
    return { next: current, updated: false };
  }
  const prev = current[unit];
  const factor = updateCalibrationFactor(prev, ratio);
  if (factor === (prev ?? 1)) {
    return { next: current, unit, updated: false };
  }
  return {
    next: { ...current, [unit]: factor },
    unit,
    updated: true,
  };
}
