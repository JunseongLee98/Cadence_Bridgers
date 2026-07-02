import { CADENCE_PUBLIC_APP_URL } from '@/lib/cadence-public-url';

export function isCadenceProductionHost(hostname: string): boolean {
  return hostname === 'bridgerscadence.com' || hostname === 'www.bridgerscadence.com';
}

export function isLocalhostFeedOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
}

/** Where POST /api/calendar/feed/sync runs (same app you are using). */
export function getCalendarFeedSyncOrigin(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin.replace(/\/$/, '');
  }
  return CADENCE_PUBLIC_APP_URL.replace(/\/$/, '');
}

/**
 * Public URL for the ICS subscription link (Google must fetch this host).
 * Local dev shows production URL; production uses the current site.
 */
export function getCalendarFeedSubscriptionOrigin(): string {
  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    if (isCadenceProductionHost(hostname)) {
      return origin.replace(/\/$/, '');
    }
    if (isLocalhostFeedOrigin(origin)) {
      return CADENCE_PUBLIC_APP_URL.replace(/\/$/, '');
    }
    return origin.replace(/\/$/, '');
  }
  return CADENCE_PUBLIC_APP_URL.replace(/\/$/, '');
}

/** @deprecated use getCalendarFeedSubscriptionOrigin */
export function getCalendarFeedServiceOrigin(): string {
  return getCalendarFeedSubscriptionOrigin();
}

/** @deprecated use getCalendarFeedSubscriptionOrigin */
export function getPublicFeedOrigin(): string {
  return getCalendarFeedSubscriptionOrigin();
}

export function buildCalendarFeedUrl(origin: string, token: string): string {
  const base = origin.replace(/\/$/, '');
  return `${base}/cadence/feed/${token}.ics`;
}

export async function probePublicCalendarFeedHealth(): Promise<boolean> {
  const base = CADENCE_PUBLIC_APP_URL.replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/calendar/feed/health`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({}));
    return data?.ok === true && data?.service === 'cadence-calendar-feed';
  } catch {
    return false;
  }
}

/** True when ICS link host differs from where sync POSTs (localhost → production). */
export function calendarFeedSyncDiffersFromSubscription(): boolean {
  if (typeof window === 'undefined') return false;
  return getCalendarFeedSyncOrigin() !== getCalendarFeedSubscriptionOrigin();
}
