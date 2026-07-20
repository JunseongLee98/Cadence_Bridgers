import { describe, expect, it } from 'vitest';
import {
  buildDecomposeUserPrompt,
  decomposeLanguageInstruction,
  ensureSubtaskDueDates,
} from '@/lib/decompose-assignment';

describe('decomposeLanguageInstruction', () => {
  it('requires Korean titles/descriptions for ko locale', () => {
    const text = decomposeLanguageInstruction('ko');
    expect(text).toMatch(/Korean|한국어/);
    expect(text).not.toMatch(/same language as the assignment/);
  });

  it('requires English for en locale', () => {
    const text = decomposeLanguageInstruction('en');
    expect(text).toMatch(/English/);
  });

  it('falls back to matching assignment language when locale missing', () => {
    const text = decomposeLanguageInstruction(undefined);
    expect(text).toMatch(/same language as the assignment/i);
  });
});

describe('buildDecomposeUserPrompt', () => {
  it('asks for fewer coarser steps instead of micro-splitting', () => {
    const prompt = buildDecomposeUserPrompt({
      title: 'Write a short reflection',
      description: 'One page reflection on the reading',
    });
    expect(prompt).toMatch(/Prefer 2–4 subtasks/);
    expect(prompt).toMatch(/at most 5/);
    expect(prompt).toMatch(/over-split|Never invent busywork|coarse/i);
    expect(prompt).not.toMatch(/3–10/);
  });

  it('requests a fixed step count when stepCount is set', () => {
    const prompt = buildDecomposeUserPrompt({
      title: 'Research paper',
      stepCount: 4,
    });
    expect(prompt).toMatch(/exactly 4 subtasks/);
  });

  it('asks for per-subtask dueDate fields', () => {
    const prompt = buildDecomposeUserPrompt({
      title: 'Lab report',
      dueDate: '2026-08-01',
    });
    expect(prompt).toMatch(/"dueDate"/);
    expect(prompt).toMatch(/YYYY-MM-DD/);
    expect(prompt).not.toMatch(/Do NOT include calendar dates/);
  });
});

describe('ensureSubtaskDueDates', () => {
  it('spreads missing dates between today and assignment due', () => {
    const result = ensureSubtaskDueDates(
      [
        { title: 'A', order: 1 },
        { title: 'B', order: 2 },
        { title: 'C', order: 3 },
      ],
      '2030-06-30'
    );
    expect(result.every((s) => s.dueDate)).toBe(true);
    expect(result[0].dueDate! <= result[2].dueDate!).toBe(true);
    expect(result[2].dueDate).toBe('2030-06-30');
  });
});
