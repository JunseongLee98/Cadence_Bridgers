'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { storage } from '@/lib/storage';
import type { UserProfile } from '@/types';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = username.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName) {
      setError('Please enter your name.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    setSubmitting(true);
    try {
      const existing = storage.getUserProfile();
      const profile: UserProfile = {
        username: trimmedName,
        email: trimmedEmail,
        createdAt: existing?.createdAt ?? new Date(),
        calendarFeedToken: existing?.calendarFeedToken,
      };
      storage.saveUserProfile(profile);
      router.push('/');

      /* Email verification (re-enable with EMAIL_FEATURES_ENABLED in lib/email-features.ts)
      const res = await fetch('/api/auth/verify-email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, username: trimmedName }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === 'string' ? data.error : 'Could not send verification email.');
        return;
      }
      */
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-primary-dark">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#494262] shadow-2xl p-8 text-white">
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/cadence-logo-black.png"
            alt="Cadence"
            width={56}
            height={56}
            className="rounded-lg bg-white/90 p-1"
          />
          <h1 className="mt-4 text-2xl font-semibold">Welcome to Cadence</h1>
          <p className="mt-2 text-sm text-white/75 text-center">
            Sign in with your name and email to save your profile and calendar subscription.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-white/90 mb-1">
              Username
            </label>
            <input
              id="username"
              type="text"
              autoComplete="name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-amber-400/80"
              placeholder="Your name"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-white/90 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-amber-400/80"
              placeholder="you@school.edu"
            />
          </div>

          {error && (
            <p className="text-sm text-red-200 bg-red-900/30 border border-red-400/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-amber-400 text-primary-dark font-semibold py-2.5 hover:bg-amber-300 transition-colors disabled:opacity-60"
          >
            {submitting ? 'Continuing…' : 'Continue'}
          </button>
        </form>
      </div>
    </main>
  );
}
