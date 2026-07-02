'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { storage } from '@/lib/storage';
import type { UserProfile } from '@/types';
import { useI18n } from '@/lib/i18n/context';
import type { AppLocale } from '@/lib/i18n/types';

export default function LoginPage() {
  const router = useRouter();
  const { m, locale, setLocale } = useI18n();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const continueWithProfile = (profile: UserProfile) => {
    storage.saveUserProfile(profile);
    router.push('/');
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = username.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName) {
      setError(m.login.errorNameRequired);
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(m.login.errorInvalidEmail);
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
      continueWithProfile(profile);
    } catch {
      setError(m.login.errorGeneric);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => {
    setError(null);
    setSubmitting(true);
    try {
      const existing = storage.getUserProfile();
      continueWithProfile({
        username: 'Guest',
        email: 'guest@local.cadence',
        createdAt: existing?.createdAt ?? new Date(),
        calendarFeedToken: existing?.calendarFeedToken,
      });
    } catch {
      setError(m.login.errorGeneric);
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-primary-dark">
      <div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#494262] shadow-2xl p-8 text-white">
        <div className="flex justify-end mb-2">
          <label className="text-xs text-white/70 flex items-center gap-2">
            <span>{m.common.language}</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as AppLocale)}
              className="rounded-md border border-white/20 bg-white/10 px-2 py-1 text-white text-xs"
            >
              <option value="en">{m.common.english}</option>
              <option value="ko">{m.common.korean}</option>
            </select>
          </label>
        </div>

        <div className="flex flex-col items-center mb-8">
          <Image
            src="/cadence-logo-black.png"
            alt={m.login.logoAlt}
            width={56}
            height={56}
            className="rounded-lg bg-white/90 p-1"
          />
          <h1 className="mt-4 text-2xl font-semibold">{m.login.welcomeTitle}</h1>
          <p className="mt-2 text-sm text-white/75 text-center">{m.login.welcomeSubtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-white/90 mb-1">
              {m.login.usernameLabel}
            </label>
            <input
              id="username"
              type="text"
              autoComplete="name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-amber-400/80"
              placeholder={m.login.usernamePlaceholder}
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-white/90 mb-1">
              {m.login.emailLabel}
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2.5 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-amber-400/80"
              placeholder={m.login.emailPlaceholder}
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
            {submitting ? m.login.continuing : m.login.continue}
          </button>

          <button
            type="button"
            disabled={submitting}
            onClick={handleSkip}
            className="w-full rounded-lg border border-white/25 bg-transparent text-white/90 font-medium py-2.5 hover:bg-white/10 transition-colors disabled:opacity-60"
          >
            {m.login.skipForNow}
          </button>
          <p className="text-[11px] text-center text-white/50">{m.login.skipHint}</p>
        </form>
      </div>
    </main>
  );
}
