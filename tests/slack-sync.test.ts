import { describe, expect, it } from 'vitest';
import {
  buildDigestLines,
  buildStatusText,
  findActiveSession,
  findDueReminders,
  findEventsStartingInWindow,
  formatDigestMessage,
  formatReminderMessage,
  planSlackSync,
  SLACK_STATUS_EMOJI,
  type SlackSyncEvent,
} from '@/lib/slack-sync';

function event(partial: Partial<SlackSyncEvent> & Pick<SlackSyncEvent, 'start' | 'end'>): SlackSyncEvent {
  return {
    id: partial.id ?? 'e1',
    title: partial.title ?? 'Essay draft',
    start: partial.start,
    end: partial.end,
  };
}

describe('slack-sync windowing', () => {
  const now = new Date('2026-08-14T15:00:00.000Z');

  it('finds the session that currently contains now', () => {
    const events = [
      event({ id: 'past', start: new Date('2026-08-14T13:00:00.000Z'), end: new Date('2026-08-14T14:00:00.000Z') }),
      event({ id: 'active', start: new Date('2026-08-14T14:30:00.000Z'), end: new Date('2026-08-14T16:00:00.000Z') }),
      event({ id: 'later', start: new Date('2026-08-14T17:00:00.000Z'), end: new Date('2026-08-14T18:00:00.000Z') }),
    ];
    expect(findActiveSession(events, now)?.id).toBe('active');
  });

  it('windows events that start inside a cron tick', () => {
    const windowStart = new Date('2026-08-14T14:55:00.000Z');
    const windowEnd = new Date('2026-08-14T15:00:00.000Z');
    const events = [
      event({ id: 'in', start: new Date('2026-08-14T14:57:00.000Z'), end: new Date('2026-08-14T15:30:00.000Z') }),
      event({ id: 'out', start: new Date('2026-08-14T15:01:00.000Z'), end: new Date('2026-08-14T15:30:00.000Z') }),
    ];
    expect(findEventsStartingInWindow(events, windowStart, windowEnd).map((e) => e.id)).toEqual(['in']);
  });

  it('builds a status string from the session title and end time', () => {
    const text = buildStatusText(
      event({
        title: 'Lab report',
        start: now,
        end: new Date('2026-08-14T16:00:00.000Z'),
      }),
      'UTC'
    );
    expect(text).toBe('Lab report until 4:00 PM');
  });

  it('lists up to three upcoming events for the digest', () => {
    const events = [
      event({ id: '1', title: 'A', start: new Date('2026-08-15T10:00:00.000Z'), end: new Date('2026-08-15T11:00:00.000Z') }),
      event({ id: '2', title: 'B', start: new Date('2026-08-16T10:00:00.000Z'), end: new Date('2026-08-16T11:00:00.000Z') }),
      event({ id: '3', title: 'C', start: new Date('2026-08-17T10:00:00.000Z'), end: new Date('2026-08-17T11:00:00.000Z') }),
      event({ id: '4', title: 'D', start: new Date('2026-08-18T10:00:00.000Z'), end: new Date('2026-08-18T11:00:00.000Z') }),
    ];
    const lines = buildDigestLines(events, now, 'UTC');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('A');
    expect(formatDigestMessage(lines).startsWith('This week on Cadence:')).toBe(true);
  });

  it('fires a reminder when the lead time falls in this tick', () => {
    const events = [
      event({
        id: 'soon',
        title: 'Essay draft',
        start: new Date('2026-08-14T15:15:00.000Z'),
        end: new Date('2026-08-14T16:00:00.000Z'),
      }),
    ];
    const due = findDueReminders(events, now, 15, 5 * 60 * 1000, new Set());
    expect(due.map((e) => e.id)).toEqual(['soon']);
    expect(findDueReminders(events, now, 15, 5 * 60 * 1000, new Set(['soon']))).toEqual([]);
  });

  it('plans set-status when a new block becomes active', () => {
    const active = event({
      id: 'block-1',
      title: 'Focus math',
      start: new Date('2026-08-14T14:00:00.000Z'),
      end: new Date('2026-08-14T16:00:00.000Z'),
    });
    const plan = planSlackSync([active], now, {
      statusSyncEnabled: true,
      digestEnabled: false,
      timeZone: 'UTC',
      lastStatusEventId: null,
    });
    expect(plan.setStatus?.eventId).toBe('block-1');
    expect(plan.setStatus?.emoji).toBe(SLACK_STATUS_EMOJI);
    expect(plan.setStatus?.expirationUnix).toBe(Math.floor(active.end.getTime() / 1000));
    expect(plan.clearStatus).toBe(false);
    expect(plan.nextLastStatusEventId).toBe('block-1');
  });

  it('plans clear-status when the active block ends', () => {
    const plan = planSlackSync([], now, {
      statusSyncEnabled: true,
      digestEnabled: false,
      lastStatusEventId: 'block-1',
    });
    expect(plan.setStatus).toBeUndefined();
    expect(plan.clearStatus).toBe(true);
    expect(plan.nextLastStatusEventId).toBeNull();
  });

  it('does not re-set status for the same active block', () => {
    const active = event({
      id: 'block-1',
      start: new Date('2026-08-14T14:00:00.000Z'),
      end: new Date('2026-08-14T16:00:00.000Z'),
    });
    const plan = planSlackSync([active], now, {
      statusSyncEnabled: true,
      digestEnabled: false,
      lastStatusEventId: 'block-1',
    });
    expect(plan.setStatus).toBeUndefined();
    expect(plan.clearStatus).toBe(false);
  });

  it('includes digest after 8am in the user timezone once per day', () => {
    const morning = new Date('2026-08-14T12:05:00.000Z'); // 8:05 America/New_York (EDT)
    const events = [
      event({
        id: 'week',
        title: 'Problem set',
        start: new Date('2026-08-15T18:00:00.000Z'),
        end: new Date('2026-08-15T19:00:00.000Z'),
      }),
    ];
    const plan = planSlackSync(events, morning, {
      statusSyncEnabled: false,
      digestEnabled: true,
      timeZone: 'America/New_York',
      lastDigestDate: null,
    });
    expect(plan.digestLines?.[0]).toContain('Problem set');
    expect(plan.nextLastDigestDate).toBe('2026-08-14');

    const again = planSlackSync(events, morning, {
      statusSyncEnabled: false,
      digestEnabled: true,
      timeZone: 'America/New_York',
      lastDigestDate: '2026-08-14',
    });
    expect(again.digestLines).toBeUndefined();
  });

  it('formats reminder copy', () => {
    expect(formatReminderMessage({ title: 'Essay draft', minutesBefore: 15 })).toBe(
      'Starting in 15 min: Essay draft'
    );
  });
});
