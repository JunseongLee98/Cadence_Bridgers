import { describe, expect, it } from 'vitest';
import {
  normalizeWorkUnit,
  sanitizeWorkFields,
} from '@/lib/decompose-assignment';
import {
  aggregateWorkUnitStats,
  type CompletionTelemetryRecord,
} from '@/lib/completion-telemetry-store';

describe('normalizeWorkUnit', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizeWorkUnit('  Problem  Sets  ')).toBe('problem sets');
  });

  it('caps length at 40', () => {
    const long = 'a'.repeat(50);
    expect(normalizeWorkUnit(long)?.length).toBe(40);
  });

  it('returns undefined for empty or non-string', () => {
    expect(normalizeWorkUnit('   ')).toBeUndefined();
    expect(normalizeWorkUnit(null)).toBeUndefined();
    expect(normalizeWorkUnit(12)).toBeUndefined();
  });
});

describe('sanitizeWorkFields', () => {
  it('accepts valid amount + unit pairs', () => {
    expect(sanitizeWorkFields({ workAmount: 20, workUnit: 'Pages' })).toEqual({
      workAmount: 20,
      workUnit: 'pages',
    });
  });

  it('accepts numeric strings for amount', () => {
    expect(sanitizeWorkFields({ workAmount: '15.5', workUnit: 'questions' })).toEqual({
      workAmount: 15.5,
      workUnit: 'questions',
    });
  });

  it('drops incomplete or invalid pairs', () => {
    expect(sanitizeWorkFields({ workAmount: 10 })).toEqual({});
    expect(sanitizeWorkFields({ workUnit: 'pages' })).toEqual({});
    expect(sanitizeWorkFields({ workAmount: 0, workUnit: 'pages' })).toEqual({});
    expect(sanitizeWorkFields({ workAmount: -3, workUnit: 'pages' })).toEqual({});
    expect(sanitizeWorkFields({ workAmount: NaN, workUnit: 'pages' })).toEqual({});
    expect(sanitizeWorkFields({ workAmount: 5, workUnit: '  ' })).toEqual({});
  });
});

function record(
  partial: Partial<CompletionTelemetryRecord> &
    Pick<CompletionTelemetryRecord, 'actualMinutes'>
): CompletionTelemetryRecord {
  return {
    schemaVersion: 2,
    anonymousSessionId: 'sess',
    isAiBreakdown: true,
    durationSource: 'self_report',
    completedAt: '2026-01-01T00:00:00.000Z',
    receivedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('aggregateWorkUnitStats', () => {
  it('groups by unit and computes mean/median minutes per unit', () => {
    const stats = aggregateWorkUnitStats([
      record({ actualMinutes: 40, workAmount: 20, workUnit: 'pages' }), // 2 min/page
      record({ actualMinutes: 60, workAmount: 20, workUnit: 'Pages' }), // 3 min/page
      record({ actualMinutes: 30, workAmount: 10, workUnit: 'questions' }), // 3 min/q
      record({ actualMinutes: 50 }), // no work unit — skipped
      record({ actualMinutes: 10, workAmount: 0, workUnit: 'pages' }), // invalid
    ]);

    expect(stats).toEqual([
      {
        workUnit: 'pages',
        sampleCount: 2,
        meanMinutesPerUnit: 2.5,
        medianMinutesPerUnit: 2.5,
        meanActualMinutes: 50,
      },
      {
        workUnit: 'questions',
        sampleCount: 1,
        meanMinutesPerUnit: 3,
        medianMinutesPerUnit: 3,
        meanActualMinutes: 30,
      },
    ]);
  });

  it('returns empty array when no usable records', () => {
    expect(aggregateWorkUnitStats([])).toEqual([]);
    expect(
      aggregateWorkUnitStats([record({ actualMinutes: 20, workUnit: 'pages' })])
    ).toEqual([]);
  });
});
