import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarAIAgent, DEFAULT_SCHEDULE_DAYS } from '@/lib/ai-agent';
import { endOfLocalCalendarDay } from '@/lib/date-utils';
import type { CalendarEvent } from '@/types';
import { makeTask } from './helpers/task-factory';

const WORK_SEGMENTS = [{ startHour: 9, endHour: 18 }];

function blockDays(events: CalendarEvent[]): Set<string> {
  return new Set(
    events.map(
      (e) => `${e.start.getFullYear()}-${e.start.getMonth()}-${e.start.getDate()}`
    )
  );
}

describe('assignPlanStepsEvenlyAcrossDays pacing (fewer steps than days)', () => {
  it('spreads steps across the whole window instead of packing the first days', () => {
    const days = Array.from({ length: 30 }, (_, i) => `day-${i}`);
    const assigned = CalendarAIAgent.assignPlanStepsEvenlyAcrossDays(
      ['s1', 's2', 's3'],
      days
    );
    expect(assigned.get('s1')).toBe('day-0');
    expect(assigned.get('s2')).toBe('day-10');
    expect(assigned.get('s3')).toBe('day-20');
  });

  it('keeps legacy packing when steps outnumber days', () => {
    const assigned = CalendarAIAgent.assignPlanStepsEvenlyAcrossDays(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      ['Mon', 'Tue', 'Wed']
    );
    const byDay = (day: string) =>
      [...assigned.entries()].filter(([, d]) => d === day).map(([id]) => id);
    expect(byDay('Mon')).toEqual(['a', 'b', 'c']);
    expect(byDay('Tue')).toEqual(['d', 'e']);
    expect(byDay('Wed')).toEqual(['f', 'g']);
  });
});

describe('weekend opt-in via scheduleDays', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Friday April 17 2026, 10:00.
    vi.setSystemTime(new Date(2026, 3, 17, 10, 0, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('default schedule days exclude weekends', () => {
    expect(DEFAULT_SCHEDULE_DAYS).toEqual([1, 2, 3, 4, 5]);
    const slots = CalendarAIAgent.findEmptySlots(
      [],
      new Date(2026, 3, 18), // Sat
      new Date(2026, 3, 19), // Sun
      9,
      18,
      0
    );
    expect(slots).toHaveLength(0);
  });

  it('findEmptySlots opens weekend slots when Sat/Sun are allowed', () => {
    const slots = CalendarAIAgent.findEmptySlots(
      [],
      new Date(2026, 3, 18),
      new Date(2026, 3, 19),
      9,
      18,
      0,
      [0, 6]
    );
    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect([0, 6]).toContain(slot.start.getDay());
    }
  });

  it('nextWeekdayOnOrAfter honors custom schedule days', () => {
    const saturday = new Date(2026, 3, 18);
    expect(CalendarAIAgent.nextWeekdayOnOrAfter(saturday).getDay()).toBe(1); // default → Monday
    expect(CalendarAIAgent.nextWeekdayOnOrAfter(saturday, [6]).getDay()).toBe(6);
  });

  it('distributeTasks places work on an opted-in weekend but never by default', () => {
    const task = makeTask({
      id: 'weekend-task',
      title: 'Weekend study',
      estimatedDuration: 120,
    });
    const start = new Date(2026, 3, 18, 0, 0, 0, 0); // Sat
    const end = new Date(2026, 3, 19, 23, 59, 59, 999); // Sun

    const withoutWeekends = CalendarAIAgent.distributeTasks(
      [task],
      [],
      start,
      end,
      WORK_SEGMENTS,
      0,
      50
    );
    expect(withoutWeekends).toHaveLength(0);

    const withWeekends = CalendarAIAgent.distributeTasks(
      [task],
      [],
      start,
      end,
      WORK_SEGMENTS,
      0,
      50,
      [1, 2, 3, 4, 5, 6, 0]
    );
    const totalMinutes = withWeekends.reduce(
      (acc, e) => acc + (e.end.getTime() - e.start.getTime()) / 60000,
      0
    );
    expect(totalMinutes).toBe(120);
    for (const e of withWeekends) {
      expect([0, 6]).toContain(e.start.getDay());
    }
  });
});

describe('due-anchored assignment windows (syllabus demo model)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Monday April 13 2026, 14:00 — "today" for the student.
    vi.setSystemTime(new Date(2026, 3, 13, 14, 0, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('an assignment due weeks out gets no work suggested before its window opens', () => {
    const due = new Date(2026, 5, 5, 0, 0, 0, 0); // June 5
    const planId = 'plan-far-due';
    const tasks = [1, 2, 3].map((order) =>
      makeTask({
        id: `far-step-${order}`,
        title: `Step ${order}`,
        estimatedDuration: 60,
        dueDate: due,
        planId,
        planStepOrder: order,
      })
    );

    // Demo model: window anchored backward from the due date (lead ≈ one week),
    // NOT from today — empty weeks in April/May must stay empty.
    const windowStart = new Date(2026, 4, 29, 0, 0, 0, 0); // May 29
    const events = CalendarAIAgent.distributeTasks(
      tasks,
      [],
      windowStart,
      endOfLocalCalendarDay(due),
      WORK_SEGMENTS,
      10,
      50
    );

    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(e.start.getTime()).toBeGreaterThanOrEqual(windowStart.getTime());
      expect(e.end.getTime()).toBeLessThanOrEqual(endOfLocalCalendarDay(due).getTime());
    }
    // Steps must not all collapse onto the window's first day either.
    expect(blockDays(events).size).toBeGreaterThan(1);
  });

  it('two assignments keep their work inside their own due windows', () => {
    const dueSoon = new Date(2026, 3, 17, 0, 0, 0, 0); // Fri April 17
    const dueLater = new Date(2026, 4, 22, 0, 0, 0, 0); // May 22

    const soonTasks = [1, 2].map((order) =>
      makeTask({
        id: `soon-${order}`,
        title: `HW1 step ${order}`,
        estimatedDuration: 60,
        dueDate: dueSoon,
        planId: 'plan-soon',
        planStepOrder: order,
      })
    );
    const laterTasks = [1, 2].map((order) =>
      makeTask({
        id: `later-${order}`,
        title: `HW2 step ${order}`,
        estimatedDuration: 60,
        dueDate: dueLater,
        planId: 'plan-later',
        planStepOrder: order,
      })
    );

    // Demo model schedules one assignment at a time, earlier due first,
    // feeding placed blocks forward as busy time.
    const today = new Date(2026, 3, 13, 0, 0, 0, 0);
    const soonEvents = CalendarAIAgent.distributeTasks(
      soonTasks,
      [],
      today,
      endOfLocalCalendarDay(dueSoon),
      WORK_SEGMENTS,
      10,
      50
    );
    const laterWindowStart = new Date(2026, 4, 15, 0, 0, 0, 0); // May 15
    const laterEvents = CalendarAIAgent.distributeTasks(
      laterTasks,
      soonEvents,
      laterWindowStart,
      endOfLocalCalendarDay(dueLater),
      WORK_SEGMENTS,
      10,
      50
    );

    expect(soonEvents.length).toBeGreaterThan(0);
    expect(laterEvents.length).toBeGreaterThan(0);
    for (const e of soonEvents) {
      expect(e.end.getTime()).toBeLessThanOrEqual(endOfLocalCalendarDay(dueSoon).getTime());
    }
    for (const e of laterEvents) {
      expect(e.start.getTime()).toBeGreaterThanOrEqual(laterWindowStart.getTime());
      expect(e.end.getTime()).toBeLessThanOrEqual(endOfLocalCalendarDay(dueLater).getTime());
    }
  });
});
