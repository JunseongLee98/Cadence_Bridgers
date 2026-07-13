import { describe, expect, it } from 'vitest';
import { decomposeLanguageInstruction } from '@/lib/decompose-assignment';

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
