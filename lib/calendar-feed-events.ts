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
};

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
