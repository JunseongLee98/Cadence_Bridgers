import type { CalendarEvent } from '@/types';

/** Local Cadence events to publish on the subscription feed (excludes Google / ICS subscriptions). */
export function filterEventsForCalendarFeed(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter(
    (e) => !e.id.startsWith('google-') && !e.id.startsWith('ics-sub-')
  );
}

export type SerializedFeedEvent = {
  id: string;
  title: string;
  description?: string;
  start: string;
  end: string;
  taskId?: string;
  /** RFC5545 SEQUENCE — bumped when event content changes so clients detect updates. */
  sequence?: number;
};

/**
 * A cancelled event that used to be in the feed. We keep emitting it as a
 * STATUS:CANCELLED VEVENT (with a bumped SEQUENCE) for a retention window so
 * subscribers (Google/Apple/Outlook) actually delete the event instead of
 * keeping their last-known copy when it simply disappears from the feed.
 */
export type FeedTombstone = {
  id: string;
  title: string;
  start: string;
  end: string;
  taskId?: string;
  sequence: number;
  cancelledAt: string;
};

/** How long a cancelled event keeps being published so clients can pick up the removal. */
export const FEED_TOMBSTONE_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

function feedEventFingerprint(e: Pick<SerializedFeedEvent, 'start' | 'end' | 'title' | 'description'>): string {
  return `${e.start}|${e.end}|${e.title}|${e.description ?? ''}`;
}

/** Preserve SEQUENCE; increment when an event's content changes or when it is new. */
export function mergeFeedEventSequences(
  incoming: SerializedFeedEvent[],
  existing: SerializedFeedEvent[] | undefined
): SerializedFeedEvent[] {
  const prevById = new Map<string, { sequence: number; fingerprint: string }>();
  for (const e of existing ?? []) {
    prevById.set(e.id, {
      sequence: e.sequence ?? 0,
      fingerprint: feedEventFingerprint(e),
    });
  }

  return incoming.map((e) => {
    const fp = feedEventFingerprint(e);
    const prev = prevById.get(e.id);
    if (!prev) {
      return { ...e, sequence: 0 };
    }
    if (prev.fingerprint === fp) {
      return { ...e, sequence: prev.sequence };
    }
    return { ...e, sequence: prev.sequence + 1 };
  });
}

/**
 * Reconcile an incoming set of events with the previously stored state.
 *
 * - Keeps/bumps SEQUENCE for events that stay (bumped only when content changes).
 * - Revives an event that was previously cancelled (continues its SEQUENCE).
 * - Emits a tombstone for any previously-present event that is now gone, so the
 *   feed can publish it as STATUS:CANCELLED and subscribers remove it.
 * - Carries forward prior tombstones that are still within the retention window
 *   and drops the ones that expired or came back.
 */
export function reconcileFeedState(
  incoming: SerializedFeedEvent[],
  existingEvents: SerializedFeedEvent[] | undefined,
  existingTombstones: FeedTombstone[] | undefined,
  now: Date = new Date()
): { events: SerializedFeedEvent[]; tombstones: FeedTombstone[] } {
  const prevEventsById = new Map<string, SerializedFeedEvent>();
  for (const e of existingEvents ?? []) prevEventsById.set(e.id, e);

  const prevTombById = new Map<string, FeedTombstone>();
  for (const t of existingTombstones ?? []) prevTombById.set(t.id, t);

  const incomingIds = new Set(incoming.map((e) => e.id));

  const events: SerializedFeedEvent[] = incoming.map((e) => {
    const fp = feedEventFingerprint(e);
    const prev = prevEventsById.get(e.id);
    if (prev) {
      const prevSeq = prev.sequence ?? 0;
      return { ...e, sequence: feedEventFingerprint(prev) === fp ? prevSeq : prevSeq + 1 };
    }
    const tomb = prevTombById.get(e.id);
    if (tomb) {
      return { ...e, sequence: tomb.sequence + 1 };
    }
    return { ...e, sequence: 0 };
  });

  const nowIso = now.toISOString();
  const tombstones: FeedTombstone[] = [];
  const seenTomb = new Set<string>();

  for (const prev of existingEvents ?? []) {
    if (incomingIds.has(prev.id)) continue;
    tombstones.push({
      id: prev.id,
      title: prev.title,
      start: prev.start,
      end: prev.end,
      taskId: prev.taskId,
      sequence: (prev.sequence ?? 0) + 1,
      cancelledAt: nowIso,
    });
    seenTomb.add(prev.id);
  }

  for (const t of existingTombstones ?? []) {
    if (incomingIds.has(t.id)) continue;
    if (seenTomb.has(t.id)) continue;
    const age = now.getTime() - new Date(t.cancelledAt).getTime();
    if (Number.isFinite(age) && age <= FEED_TOMBSTONE_RETENTION_MS) {
      tombstones.push(t);
      seenTomb.add(t.id);
    }
  }

  return { events, tombstones };
}

export function serializeFeedEvents(events: CalendarEvent[]): SerializedFeedEvent[] {
  return filterEventsForCalendarFeed(events).map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    start: e.start.toISOString(),
    end: e.end.toISOString(),
    taskId: e.taskId,
  }));
}

export function deserializeFeedEvents(rows: SerializedFeedEvent[]): CalendarEvent[] {
  return rows.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    start: new Date(e.start),
    end: new Date(e.end),
    taskId: e.taskId,
    isScheduled: Boolean(e.taskId) || e.id.startsWith('scheduled-'),
  }));
}
