import { describe, expect, it } from 'vitest';
import {
  applyCalibration,
  applyRatioToCalibrationMap,
  calibrateSubtaskEstimates,
  clampCalibrationFactor,
  estimateActualRatio,
  shouldUpdateCalibration,
  updateCalibrationFactor,
  CALIBRATION_FACTOR_MAX,
  CALIBRATION_FACTOR_MIN,
} from '@/lib/estimate-calibration';

describe('estimateActualRatio', () => {
  it('returns actual/estimate when valid', () => {
    expect(estimateActualRatio(90, 60)).toBe(1.5);
  });

  it('rejects invalid inputs', () => {
    expect(estimateActualRatio(10, 0)).toBeUndefined();
    expect(estimateActualRatio(-1, 30)).toBeUndefined();
  });
});

describe('shouldUpdateCalibration', () => {
  it('ignores small gaps', () => {
    expect(shouldUpdateCalibration(1.1)).toBe(false);
    expect(shouldUpdateCalibration(0.9)).toBe(false);
  });

  it('triggers on large gaps', () => {
    expect(shouldUpdateCalibration(1.5)).toBe(true);
    expect(shouldUpdateCalibration(0.5)).toBe(true);
  });
});

describe('updateCalibrationFactor', () => {
  it('moves slightly toward the observed ratio and clamps', () => {
    const next = updateCalibrationFactor(1, 2);
    expect(next).toBeGreaterThan(1);
    expect(next).toBeLessThan(2);
    expect(next).toBeLessThanOrEqual(CALIBRATION_FACTOR_MAX);
    expect(updateCalibrationFactor(1, 0.1)).toBeGreaterThanOrEqual(CALIBRATION_FACTOR_MIN);
  });

  it('leaves factor unchanged for small gaps', () => {
    expect(updateCalibrationFactor(1.2, 1.1)).toBe(clampCalibrationFactor(1.2));
  });
});

describe('applyCalibration / calibrateSubtaskEstimates', () => {
  it('scales estimates by factor with minute bounds', () => {
    expect(applyCalibration(60, 1.25)).toBe(75);
    expect(applyCalibration(10, 0.7)).toBe(15);
  });

  it('only adjusts subtasks that have a matching unit factor', () => {
    const result = calibrateSubtaskEstimates(
      [
        { title: 'Read', estimatedMinutes: 40, workUnit: 'pages', order: 1 },
        { title: 'Brainstorm', estimatedMinutes: 30, order: 2 },
      ],
      { pages: 1.4 }
    );
    expect(result[0].estimatedMinutes).toBe(56);
    expect(result[1].estimatedMinutes).toBe(30);
  });
});

describe('applyRatioToCalibrationMap', () => {
  it('updates only when gap is large and unit is present', () => {
    const { next, updated, unit } = applyRatioToCalibrationMap({}, 'Pages', 1.5);
    expect(updated).toBe(true);
    expect(unit).toBe('pages');
    expect(next.pages).toBeGreaterThan(1);

    const small = applyRatioToCalibrationMap({ pages: 1.1 }, 'pages', 1.05);
    expect(small.updated).toBe(false);
  });
});
