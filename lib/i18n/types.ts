export type AppLocale = 'en' | 'ko';

export const DEFAULT_LOCALE: AppLocale = 'en';

export const LOCALE_STORAGE_KEY = 'cadence_locale';

export function isAppLocale(value: string): value is AppLocale {
  return value === 'en' || value === 'ko';
}

export function dateLocaleTag(locale: AppLocale): string {
  return locale === 'ko' ? 'ko-KR' : 'en-US';
}
