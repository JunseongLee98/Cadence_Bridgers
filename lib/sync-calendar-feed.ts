import type { CalendarEvent } from '@/types';
import { serializeFeedEvents } from '@/lib/calendar-feed-events';
import { getCalendarFeedSyncOrigin } from '@/lib/calendar-feed-url';

export type SyncCalendarFeedResult = {
  ok: boolean;
  error?: string;
  eventCount?: number;
};

export async function syncCalendarFeedToServer(
  token: string,
  events: CalendarEvent[],
  username?: string,
  revokeToken?: string
): Promise<SyncCalendarFeedResult> {
  try {
    const base = getCalendarFeedSyncOrigin().replace(/\/$/, '');
    const res = await fetch(`${base}/api/calendar/feed/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        username,
        events: serializeFeedEvents(events),
        revokeToken,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: typeof data.error === 'string' ? data.error : 'Sync failed' };
    }
    return {
      ok: true,
      eventCount: typeof data.eventCount === 'number' ? data.eventCount : undefined,
    };
  } catch {
    return { ok: false, error: 'Network error while syncing calendar feed' };
  }
}
