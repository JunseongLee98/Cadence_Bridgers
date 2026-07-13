import ICAL from 'ical.js';
import type { SerializedFeedEvent } from '@/lib/calendar-feed-events';
import {
  AppleAuthError,
  buildCadenceVEventIcs,
  cadenceObjectFilename,
  createAppleDavSession,
  extractCadenceIdFromIcs,
  findOrCreateCadenceCalendar,
} from '@/lib/apple-caldav';

export type ApplePushResult = {
  calendarUrl: string;
  created: number;
  updated: number;
  deleted: number;
};

function fingerprint(e: {
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
}): string {
  return `${e.start ?? ''}|${e.end ?? ''}|${e.summary ?? ''}|${e.description ?? ''}`;
}

function parseIcsFingerprint(data: string): {
  summary?: string;
  description?: string;
  start?: string;
  end?: string;
} {
  try {
    const jcalData = ICAL.parse(data);
    const comp = new ICAL.Component(jcalData);
    const vevent = comp.getFirstSubcomponent('vevent');
    if (!vevent) return {};
    const event = new ICAL.Event(vevent);
    const summary = vevent.getFirstPropertyValue('summary');
    const description = vevent.getFirstPropertyValue('description');
    return {
      summary: typeof summary === 'string' ? summary : undefined,
      description: typeof description === 'string' ? description : undefined,
      start: event.startDate?.toJSDate?.()?.toISOString?.() ?? '',
      end: event.endDate?.toJSDate?.()?.toISOString?.() ?? '',
    };
  } catch {
    return {};
  }
}

/**
 * Reconcile Cadence events into a dedicated (or selected) Apple Calendar via CalDAV.
 */
export async function syncEventsToApple(
  creds: { appleId: string; appSpecificPassword: string },
  desired: SerializedFeedEvent[],
  knownCalendarUrl?: string
): Promise<ApplePushResult> {
  let client;
  try {
    client = await createAppleDavSession(creds);
  } catch (error) {
    if (error instanceof AppleAuthError) throw error;
    throw error;
  }

  const calendar = await findOrCreateCadenceCalendar(client, knownCalendarUrl);
  const calendarUrl = calendar.url;

  let objects;
  try {
    objects = await client.fetchCalendarObjects({ calendar });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/401|unauthorized|forbidden/i.test(message)) {
      throw new AppleAuthError(
        'Apple Calendar session expired or app-specific password was revoked.'
      );
    }
    throw error;
  }

  type ManagedObject = {
    url: string;
    etag?: string;
    data: string;
    cadenceId: string;
  };

  const existingByCadenceId = new Map<string, ManagedObject[]>();
  for (const obj of objects) {
    const data = typeof obj.data === 'string' ? obj.data : undefined;
    if (!data || !obj.url) continue;
    const cadenceId = extractCadenceIdFromIcs(data);
    if (!cadenceId) continue;
    const row: ManagedObject = {
      url: obj.url,
      etag: obj.etag,
      data,
      cadenceId,
    };
    const list = existingByCadenceId.get(cadenceId);
    if (list) list.push(row);
    else existingByCadenceId.set(cadenceId, [row]);
  }

  const desiredById = new Map<string, SerializedFeedEvent>();
  for (const row of desired) {
    if (new Date(row.end).getTime() > new Date(row.start).getTime()) {
      desiredById.set(row.id, row);
    }
  }

  let created = 0;
  let updated = 0;
  let deleted = 0;

  const deleteObject = async (managed: ManagedObject): Promise<boolean> => {
    const res = await client.deleteCalendarObject({
      calendarObject: { url: managed.url, etag: managed.etag, data: managed.data },
    });
    return res.ok || res.status === 404 || res.status === 410;
  };

  for (const [id, row] of desiredById) {
    const matches = existingByCadenceId.get(id) ?? [];
    const ics = buildCadenceVEventIcs(row);
    const after = fingerprint({
      summary: row.title,
      description: row.description,
      start: new Date(row.start).toISOString(),
      end: new Date(row.end).toISOString(),
    });

    if (matches.length === 0) {
      const res = await client.createCalendarObject({
        calendar,
        filename: cadenceObjectFilename(id),
        iCalString: ics,
      });
      if (res.ok || res.status === 201 || res.status === 204) created += 1;
      continue;
    }

    const [match, ...duplicates] = matches;
    for (const dup of duplicates) {
      if (await deleteObject(dup)) deleted += 1;
    }

    const before = fingerprint(parseIcsFingerprint(match.data));
    if (before !== after) {
      const res = await client.updateCalendarObject({
        calendarObject: {
          url: match.url,
          etag: match.etag,
          data: ics,
        },
      });
      if (res.ok || res.status === 204) updated += 1;
    }
  }

  for (const [id, managedList] of existingByCadenceId) {
    if (desiredById.has(id)) continue;
    for (const managed of managedList) {
      if (await deleteObject(managed)) deleted += 1;
    }
  }

  return { calendarUrl, created, updated, deleted };
}
