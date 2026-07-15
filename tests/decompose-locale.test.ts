import { describe, expect, it } from 'vitest';
import {
  buildDecomposeUserPrompt,
  decomposeLanguageInstruction,
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
});
