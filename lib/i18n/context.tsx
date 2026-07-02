'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import moment from 'moment';
import 'moment/locale/ko';
import { storage } from '@/lib/storage';
import { formatMessage, getMessages, type Messages } from '@/lib/i18n/messages';
import {
  type AppLocale,
  DEFAULT_LOCALE,
  dateLocaleTag,
  isAppLocale,
} from '@/lib/i18n/types';

type I18nContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
  m: Messages;
  dateLocale: string;
  t: (path: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function resolvePath(messages: Messages, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = messages;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(DEFAULT_LOCALE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = storage.getLocale();
    if (stored) setLocaleState(stored);
    setHydrated(true);
  }, []);

  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next);
    storage.saveLocale(next);
  }, []);

  const m = useMemo(() => getMessages(locale), [locale]);
  const dateLocale = dateLocaleTag(locale);

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.lang = locale === 'ko' ? 'ko' : 'en';
    moment.locale(locale === 'ko' ? 'ko' : 'en');
  }, [locale, hydrated]);

  const t = useCallback(
    (path: string, vars?: Record<string, string | number>) => {
      const raw = resolvePath(m, path);
      if (raw == null) return path;
      return formatMessage(raw, vars);
    },
    [m]
  );

  const value = useMemo(
    () => ({ locale, setLocale, m, dateLocale, t }),
    [locale, setLocale, m, dateLocale, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}

export function useI18nOptional(): I18nContextValue | null {
  return useContext(I18nContext);
}

export function readInitialLocale(): AppLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  const stored = storage.getLocale();
  return stored ?? DEFAULT_LOCALE;
}

export { isAppLocale };
