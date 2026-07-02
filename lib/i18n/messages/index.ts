import { en } from '@/lib/i18n/messages/en';
import { ko } from '@/lib/i18n/messages/ko';
import type { AppLocale } from '@/lib/i18n/types';

export const messages = { en, ko } as const;

export type Messages = typeof en;

export function getMessages(locale: AppLocale): Messages {
  return (locale === 'ko' ? ko : en) as Messages;
}

/** Replace `{name}` placeholders in translation strings. */
export function formatMessage(
  template: string,
  vars?: Record<string, string | number>
): string {
  if (!vars) return template;
  return Object.entries(vars).reduce(
    (acc, [key, value]) => acc.replaceAll(`{${key}}`, String(value)),
    template
  );
}
