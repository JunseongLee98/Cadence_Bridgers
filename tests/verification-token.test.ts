import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  createEmailVerificationToken,
  parseEmailVerificationToken,
} from '@/lib/verification-token';

describe('email verification token', () => {
  beforeEach(() => {
    vi.stubEnv('EMAIL_VERIFICATION_SECRET', 'test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips a valid token', () => {
    const token = createEmailVerificationToken('user@example.com');
    const parsed = parseEmailVerificationToken(token);
    expect(parsed?.email).toBe('user@example.com');
  });

  it('rejects tampered tokens', () => {
    const token = createEmailVerificationToken('user@example.com');
    const bad = token.slice(0, -2) + 'xx';
    expect(parseEmailVerificationToken(bad)).toBeNull();
  });
});
