import { CADENCE_PUBLIC_APP_URL } from '@/lib/cadence-public-url';

export function isCadenceProductionHost(hostname: string): boolean {
  return hostname === 'bridgerscadence.com' || hostname === 'www.bridgerscadence.com';
}

/** Where the ICS feed is hosted (must match where sync POSTs). */
export function getCalendarFeedServiceOrigin(): string {
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

/** @deprecated use getCalendarFeedServiceOrigin */
export function getPublicFeedOrigin(): string {
  return getCalendarFeedServiceOrigin();
}

export function getCalendarFeedSyncOrigin(): string {
  return getCalendarFeedServiceOrigin();
}

export function isLocalhostFeedOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch {
    return false;
  }
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
