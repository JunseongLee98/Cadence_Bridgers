/** Cadence → Slack tick planner. Pure functions; the cron route applies side effects. */

export const SLACK_SYNC_TICK_MS = 5 * 60 * 1000;
export const SLACK_STATUS_EMOJI = ':dart:';

export type SlackSyncEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
};

export type SlackSyncPrefs = {
  statusSyncEnabled: boolean;
  digestEnabled: boolean;
  reminderMinutesBefore?: number;
  timeZone?: string;
  lastStatusEventId?: string | null;
  lastDigestDate?: string | null;
  remindedEventIds?: string[];
};

export type SlackSyncPlan = {
  setStatus?: {
    eventId: string;
    text: string;
    emoji: string;
    expirationUnix: number;
  };
  clearStatus: boolean;
  digestLines?: string[];
  reminders: Array<{
    eventId: string;
    title: string;
    start: Date;
    minutesBefore: number;
  }>;
  nextLastStatusEventId: string | null;
  nextLastDigestDate: string | null;
  nextRemindedEventIds: string[];
};

function safeTimeZone(timeZone?: string): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

export function dateKeyInTimeZone(now: Date, timeZone?: string): string {
  return now.toLocaleDateString('en-CA', { timeZone: safeTimeZone(timeZone) });
}

export function hourInTimeZone(now: Date, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTimeZone(timeZone),
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return Number.isFinite(hour) ? hour : now.getUTCHours();
}

export function formatTimeInTimeZone(date: Date, timeZone?: string): string {
  return date.toLocaleTimeString('en-US', {
    timeZone: safeTimeZone(timeZone),
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatWeekdayTime(date: Date, timeZone?: string): string {
  const tz = safeTimeZone(timeZone);
  const weekday = date.toLocaleDateString('en-US', { timeZone: tz, weekday: 'short' });
  return `${weekday} ${formatTimeInTimeZone(date, tz)}`;
}

export function findActiveSession(
  events: SlackSyncEvent[],
  now: Date
): SlackSyncEvent | null {
  const t = now.getTime();
  return (
    events.find((e) => e.start.getTime() <= t && t < e.end.getTime()) ?? null
  );
}

/** Events whose start falls in [windowStart, windowEnd). */
export function findEventsStartingInWindow(
  events: SlackSyncEvent[],
  windowStart: Date,
  windowEnd: Date
): SlackSyncEvent[] {
  const a = windowStart.getTime();
  const b = windowEnd.getTime();
  return events.filter((e) => {
    const start = e.start.getTime();
    return start >= a && start < b;
  });
}

export function buildStatusText(event: SlackSyncEvent, timeZone?: string): string {
  const until = formatTimeInTimeZone(event.end, timeZone);
  const title = event.title.trim();
  const prefix = title ? title : 'Focus block';
  const text = `${prefix} until ${until}`;
  return text.length <= 100 ? text : `Focus block until ${until}`;
}

export function upcomingEventsThisWeek(
  events: SlackSyncEvent[],
  now: Date,
  limit = 3
): SlackSyncEvent[] {
  const start = now.getTime();
  const end = start + 7 * 24 * 60 * 60 * 1000;
  return events
    .filter((e) => {
      const t = e.start.getTime();
      return t >= start && t < end;
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, limit);
}

export function buildDigestLines(
  events: SlackSyncEvent[],
  now: Date,
  timeZone?: string,
  limit = 3
): string[] {
  const upcoming = upcomingEventsThisWeek(events, now, limit);
  if (upcoming.length === 0) return [];
  return upcoming.map(
    (e) => `• ${e.title.trim() || 'Focus block'} — ${formatWeekdayTime(e.start, timeZone)}`
  );
}

export function findDueReminders(
  events: SlackSyncEvent[],
  now: Date,
  minutesBefore: number,
  tickMs: number,
  alreadyReminded: Set<string>
): SlackSyncEvent[] {
  const fireStart = now.getTime();
  const fireEnd = fireStart + tickMs;
  const offsetMs = minutesBefore * 60 * 1000;
  return events.filter((e) => {
    if (alreadyReminded.has(e.id)) return false;
    const reminderAt = e.start.getTime() - offsetMs;
    return reminderAt >= fireStart && reminderAt < fireEnd;
  });
}

export function planSlackSync(
  events: SlackSyncEvent[],
  now: Date,
  prefs: SlackSyncPrefs,
  tickMs = SLACK_SYNC_TICK_MS
): SlackSyncPlan {
  const timed = events
    .filter(
      (e) =>
        Number.isFinite(e.start.getTime()) &&
        Number.isFinite(e.end.getTime()) &&
        e.end.getTime() > e.start.getTime()
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const active = prefs.statusSyncEnabled ? findActiveSession(timed, now) : null;
  const lastStatus = prefs.lastStatusEventId ?? null;
  let setStatus: SlackSyncPlan['setStatus'];
  let clearStatus = false;
  let nextLastStatusEventId = lastStatus;

  if (prefs.statusSyncEnabled) {
    if (active) {
      nextLastStatusEventId = active.id;
      if (active.id !== lastStatus) {
        setStatus = {
          eventId: active.id,
          text: buildStatusText(active, prefs.timeZone),
          emoji: SLACK_STATUS_EMOJI,
          expirationUnix: Math.floor(active.end.getTime() / 1000),
        };
      }
    } else {
      nextLastStatusEventId = null;
      if (lastStatus) clearStatus = true;
    }
  }

  const todayKey = dateKeyInTimeZone(now, prefs.timeZone);
  let digestLines: string[] | undefined;
  let nextLastDigestDate = prefs.lastDigestDate ?? null;
  if (prefs.digestEnabled && nextLastDigestDate !== todayKey && hourInTimeZone(now, prefs.timeZone) >= 8) {
    const lines = buildDigestLines(timed, now, prefs.timeZone);
    if (lines.length > 0) {
      digestLines = lines;
      nextLastDigestDate = todayKey;
    }
  }

  const reminded = new Set(prefs.remindedEventIds ?? []);
  const reminders: SlackSyncPlan['reminders'] = [];
  if (typeof prefs.reminderMinutesBefore === 'number' && prefs.reminderMinutesBefore > 0) {
    for (const event of findDueReminders(
      timed,
      now,
      prefs.reminderMinutesBefore,
      tickMs,
      reminded
    )) {
      reminders.push({
        eventId: event.id,
        title: event.title.trim() || 'Focus block',
        start: event.start,
        minutesBefore: prefs.reminderMinutesBefore,
      });
      reminded.add(event.id);
    }
  }

  const horizon = now.getTime() - 14 * 24 * 60 * 60 * 1000;
  const nextRemindedEventIds = Array.from(reminded).filter((id) => {
    const event = timed.find((e) => e.id === id);
    return !event || event.start.getTime() >= horizon;
  });

  return {
    ...(setStatus ? { setStatus } : {}),
    clearStatus,
    ...(digestLines ? { digestLines } : {}),
    reminders,
    nextLastStatusEventId,
    nextLastDigestDate,
    nextRemindedEventIds,
  };
}

export function formatDigestMessage(lines: string[]): string {
  return `This week on Cadence:\n${lines.join('\n')}`;
}

export function formatReminderMessage(reminder: {
  title: string;
  minutesBefore: number;
}): string {
  return `Starting in ${reminder.minutesBefore} min: ${reminder.title}`;
}
