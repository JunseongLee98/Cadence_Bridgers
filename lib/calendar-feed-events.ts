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
