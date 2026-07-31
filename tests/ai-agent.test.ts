import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarAIAgent } from '@/lib/ai-agent';
import { SCHEDULE_MAX_HORIZON_DAYS } from '@/lib/schedule-constants';
import type { CalendarEvent, Task } from '@/types';
import { makeTask } from './helpers/task-factory';

function eventMinutesForTask(events: CalendarEvent[], taskId: string): number {
  return events
    .filter((e) => e.taskId === taskId)
    .reduce((acc, e) => acc + (e.end.getTime() - e.start.getTime()) / (1000 * 60), 0);
}

function baseTask(overrides: Partial<Task> & Pick<Task, 'title'>): Task {
  return makeTask(overrides);
}

describe('CalendarAIAgent.coerceEstimatedMinutes', () => {
  it('normalizes numbers and numeric strings', () => {
    expect(CalendarAIAgent.coerceEstimatedMinutes(360)).toBe(360);
    expect(CalendarAIAgent.coerceEstimatedMinutes(' 180.4 ')).toBe(180);
  });

  it('falls back to 60 for invalid input', () => {
    expect(CalendarAIAgent.coerceEstimatedMinutes(undefined)).toBe(60);
    expect(CalendarAIAgent.coerceEstimatedMinutes('')).toBe(60);
    expect(CalendarAIAgent.coerceEstimatedMinutes(NaN)).toBe(60);
    expect(CalendarAIAgent.coerceEstimatedMinutes(-10)).toBe(60);
  });
});

describe('CalendarAIAgent.calculateTaskDuration', () => {
  it('uses estimate for incomplete task when set (number)', () => {
    const t = baseTask({
      title: 'A',
      estimatedDuration: 360,
      actualDurations: [],
    });
    expect(CalendarAIAgent.calculateTaskDuration(t)).toBe(360);
  });

  it('parses string estimate for incomplete task', () => {
    const t = baseTask({
      title: 'A',
      estimatedDuration: '240' as unknown as number,
      actualDurations: [],
    });
    expect(CalendarAIAgent.calculateTaskDuration(t)).toBe(240);
  });

  it('defaults to 60 when no estimate and no actuals', () => {
    const t = baseTask({ title: 'A', actualDurations: [] });
    expect(CalendarAIAgent.calculateTaskDuration(t)).toBe(60);
  });

  it('treats non-numeric string estimate as missing', () => {
    const t = baseTask({
      title: 'A',
      estimatedDuration: 'abc' as unknown as number,
      actualDurations: [],
    });
    expect(CalendarAIAgent.calculateTaskDuration(t)).toBe(60);
  });

  it('uses average of actuals when present and no active estimate branch for completed', () => {
    const t = baseTask({
      title: 'A',
      estimatedDuration: 120,
      actualDurations: [100, 140],
      completedAt: new Date(),
    });
    expect(CalendarAIAgent.calculateTaskDuration(t)).toBe(120);
  });

  it('handles huge estimate', () => {
    const t = baseTask({
      title: 'A',
      estimatedDuration: 60 * 24 * 14,
      actualDurations: [],
    });
    expect(CalendarAIAgent.calculateTaskDuration(t)).toBe(60 * 24 * 14);
  });
});

describe('CalendarAIAgent.chunkDurationByFocus', () => {
  it('splits 120 min with focus 50', () => {
    expect(CalendarAIAgent.chunkDurationByFocus(120, 50)).toEqual([50, 50, 20]);
  });

  it('merges tail under 15 into previous chunk', () => {
    const c = CalendarAIAgent.chunkDurationByFocus(360, 50);
    expect(c.reduce((a, b) => a + b, 0)).toBe(360);
    expect(c.every((x) => x >= 15 || c.length === 1)).toBe(true);
  });

  it('handles focus equal to duration', () => {
    expect(CalendarAIAgent.chunkDurationByFocus(50, 50)).toEqual([50]);
  });

  it('handles tiny duration', () => {
    expect(CalendarAIAgent.chunkDurationByFocus(5, 50)).toEqual([5]);
  });
});

describe('CalendarAIAgent.findEmptySlots', () => {
  it('skips weekends', () => {
    const start = new Date(2026, 3, 13);
    const end = new Date(2026, 3, 19);
    const slots = CalendarAIAgent.findEmptySlots([], start, end, 9, 18, 0);
    const days = new Set(
      slots.map((s) => `${s.start.getFullYear()}-${s.start.getMonth()}-${s.start.getDate()}`)
    );
    for (const s of slots) {
      const dow = s.start.getDay();
      expect(dow).not.toBe(0);
      expect(dow).not.toBe(6);
    }
    expect(days.size).toBeGreaterThan(0);
  });

  it('clips all-day style busy block to work window', () => {
    const day = new Date(2026, 3, 15);
    const busyStart = new Date(day);
    busyStart.setHours(0, 0, 0, 0);
    const busyEnd = new Date(day);
    busyEnd.setHours(23, 59, 59, 999);
    const busy: CalendarEvent = {
      id: 'b',
      title: 'busy',
      start: busyStart,
      end: busyEnd,
      isScheduled: false,
    };
    const slots = CalendarAIAgent.findEmptySlots([busy], day, day, 9, 18, 0);
    expect(slots.length).toBe(0);
  });

  it('ignores all-day placeholders when finding free work slots', () => {
    const day = new Date(2026, 3, 15);
    const allDayStart = new Date(day);
    allDayStart.setHours(0, 0, 0, 0);
    const allDayEnd = new Date(day);
    allDayEnd.setDate(allDayEnd.getDate() + 1);
    allDayEnd.setHours(0, 0, 0, 0);
    const placeholder: CalendarEvent = {
      id: 'all-day',
      title: 'Canvas assignment due',
      start: allDayStart,
      end: allDayEnd,
      isScheduled: false,
    };
    const slots = CalendarAIAgent.findEmptySlots([placeholder], day, day, 9, 18, 0);
    // Work day should still be available: 9 hours = 540 minutes
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].duration).toBeGreaterThanOrEqual(540);
  });

  it('ignores zero-duration midnight placeholders', () => {
    const day = new Date(2026, 3, 15);
    const t = new Date(day);
    t.setHours(0, 0, 0, 0);
    const placeholder: CalendarEvent = {
      id: 'all-day-zero',
      title: 'Due date',
      start: new Date(t),
      end: new Date(t),
      isScheduled: false,
    };
    const slots = CalendarAIAgent.findEmptySlots([placeholder], day, day, 9, 18, 0);
    expect(slots.length).toBeGreaterThan(0);
  });

  it('respects break after events', () => {
    const day = new Date(2026, 3, 15);
    const e0 = new Date(day);
    e0.setHours(9, 0, 0, 0);
    const e1 = new Date(day);
    e1.setHours(10, 0, 0, 0);
    const ev: CalendarEvent = {
      id: 'e',
      title: 'm',
      start: e0,
      end: e1,
      isScheduled: false,
    };
    const slots = CalendarAIAgent.findEmptySlots([ev], day, day, 9, 18, 30);
    const first = slots[0];
    expect(first.start.getHours()).toBeGreaterThanOrEqual(10);
    expect(first.start.getHours() * 60 + first.start.getMinutes()).toBeGreaterThanOrEqual(10 * 60 + 30);
  });
});

describe('CalendarAIAgent.computeScheduleEndDate', () => {
  it('extends at least minHorizonDays without dues', () => {
    const start = new Date(2026, 0, 1, 0, 0, 0, 0);
    const t = baseTask({ title: 'x', actualDurations: [] });
    const end = CalendarAIAgent.computeScheduleEndDate([t], start, 14, SCHEDULE_MAX_HORIZON_DAYS);
    const min = new Date(start);
    min.setDate(min.getDate() + 14);
    expect(end.getTime()).toBeGreaterThanOrEqual(
      new Date(min.getFullYear(), min.getMonth(), min.getDate(), 23, 59, 59, 999).getTime() - 1
    );
  });

  it('extends through latest due', () => {
    const start = new Date(2026, 0, 1, 0, 0, 0, 0);
    const due = new Date(2026, 1, 20, 0, 0, 0, 0);
    const t = baseTask({ title: 'x', dueDate: due, actualDurations: [] });
    const end = CalendarAIAgent.computeScheduleEndDate([t], start, 14, SCHEDULE_MAX_HORIZON_DAYS);
    expect(end.getMonth()).toBe(1);
    expect(end.getDate()).toBeGreaterThanOrEqual(20);
  });

  it('respects maxHorizonDays cap', () => {
    const start = new Date(2026, 0, 1, 0, 0, 0, 0);
    const due = new Date(2027, 5, 1);
    const t = baseTask({ title: 'x', dueDate: due, actualDurations: [] });
    const end = CalendarAIAgent.computeScheduleEndDate([t], start, 14, 30);
    const cap = new Date(start);
    cap.setDate(cap.getDate() + 30);
    expect(end.getTime()).toBeLessThanOrEqual(
      new Date(cap.getFullYear(), cap.getMonth(), cap.getDate(), 23, 59, 59, 999).getTime() + 1
    );
  });
});

describe('CalendarAIAgent.distributeTasks', () => {
  const monday = new Date(2026, 3, 13);
  const saturdayDue = new Date(2026, 3, 18);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 13, 14, 0, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Mirrors production: task created Monday afternoon with due Friday same week,
   * 6h estimate, default 9–18 work hours and empty busy calendar. The calendar must
   * show the full 6h (not e.g. only Monday afternoon free window) spread across weekdays.
   */
  it('April 13–17 week: all 6 estimated hours appear on the calendar, spread past Monday', () => {
    vi.setSystemTime(new Date(2026, 3, 13, 14, 0, 0, 0));

    const startDate = new Date(2026, 3, 13, 0, 0, 0, 0);
    const dueFridayApril17 = new Date(2026, 3, 17, 0, 0, 0, 0);
    const taskId = 'april-week-assignment';

    const task = baseTask({
      id: taskId,
      title: 'Six-hour assignment',
      estimatedDuration: 360,
      dueDate: dueFridayApril17,
      actualDurations: [],
    });

    const endDate = CalendarAIAgent.computeScheduleEndDate([task], startDate);

    const calendarEvents = CalendarAIAgent.distributeTasks(
      [task],
      [],
      startDate,
      endDate,
      [{ startHour: 9, endHour: 18 }],
      5,
      50
    );

    const estimatedMinutes = CalendarAIAgent.calculateTaskDuration(task);
    const displayedWorkMinutes = eventMinutesForTask(calendarEvents, taskId);

    expect(estimatedMinutes).toBe(360);
    expect(displayedWorkMinutes).toBe(360);

    const mondayAfternoonFree =
      (18 - 14) * 60;
    expect(mondayAfternoonFree).toBe(240);
    expect(displayedWorkMinutes).toBeGreaterThan(mondayAfternoonFree);

    const distinctCalendarDays = new Set(
      calendarEvents
        .filter((e) => e.taskId === taskId)
        .map((e) => `${e.start.getFullYear()}-${e.start.getMonth() + 1}-${e.start.getDate()}`)
    );
    expect(distinctCalendarDays.size).toBeGreaterThanOrEqual(2);

    for (const e of calendarEvents) {
      if (e.taskId !== taskId) continue;
      expect(e.end.getTime()).toBeLessThanOrEqual(
        new Date(2026, 3, 17, 23, 59, 59, 999).getTime() + 1
      );
      const dow = e.start.getDay();
      expect(dow).not.toBe(0);
      expect(dow).not.toBe(6);
    }
  });

  it('schedules full 6h estimate across weekdays before Saturday due (empty calendar)', () => {
    const startDate = new Date(2026, 3, 13, 0, 0, 0, 0);
    const endDate = CalendarAIAgent.computeScheduleEndDate(
      [
        baseTask({
          title: 'Big',
          id: 'big-1',
          estimatedDuration: 360,
          dueDate: saturdayDue,
          actualDurations: [],
        }),
      ],
      startDate
    );
    const task = baseTask({
      title: 'Big',
      id: 'big-1',
      estimatedDuration: 360,
      dueDate: saturdayDue,
      actualDurations: [],
    });
    const events = CalendarAIAgent.distributeTasks([task], [], startDate, endDate, [
      { startHour: 9, endHour: 18 },
    ]);
    const mins = eventMinutesForTask(events, 'big-1');
    expect(mins).toBe(360);
    const days = new Set(events.map((e) => e.start.getDate()));
    expect(days.size).toBeGreaterThan(1);
  });

  it('returns empty when no tasks', () => {
    const start = new Date(2026, 3, 13, 0, 0, 0, 0);
    const end = new Date(2026, 4, 1, 0, 0, 0, 0);
    expect(CalendarAIAgent.distributeTasks([], [], start, end)).toEqual([]);
  });

  it('deduplicates duplicate task ids', () => {
    const start = new Date(2026, 3, 13, 0, 0, 0, 0);
    const end = new Date(2026, 3, 25, 0, 0, 0, 0);
    const t = baseTask({
      title: 'Dup',
      id: 'same',
      estimatedDuration: 120,
      actualDurations: [],
    });
    const events = CalendarAIAgent.distributeTasks([t, t], [], start, end, [{ startHour: 9, endHour: 18 }]);
    expect(eventMinutesForTask(events, 'same')).toBe(120);
  });

  it('schedules higher-priority work before lower-priority when both need the same early gaps', () => {
    const start = new Date(2026, 3, 13, 0, 0, 0, 0);
    const end = new Date(2026, 3, 25, 0, 0, 0, 0);
    const low = baseTask({
      title: 'Low',
      id: 'low',
      priority: 'low',
      estimatedDuration: 120,
      actualDurations: [],
    });
    const high = baseTask({
      title: 'High',
      id: 'high',
      priority: 'high',
      estimatedDuration: 120,
      actualDurations: [],
    });
    const events = CalendarAIAgent.distributeTasks([low, high], [], start, end, [{ startHour: 9, endHour: 18 }]);
    const minHigh = Math.min(...events.filter((e) => e.taskId === 'high').map((e) => e.start.getTime()));
    const minLow = Math.min(...events.filter((e) => e.taskId === 'low').map((e) => e.start.getTime()));
    expect(minHigh).toBeLessThanOrEqual(minLow);
  });

  it('places work inside multiple disjoint work segments', () => {
    vi.setSystemTime(new Date(2026, 3, 15, 8, 0, 0, 0));
    const start = new Date(2026, 3, 15, 0, 0, 0, 0);
    const end = new Date(2026, 3, 16, 0, 0, 0, 0);
    const task = baseTask({
      title: 'Split day',
      id: 'seg-1',
      estimatedDuration: 180,
      actualDurations: [],
    });
    const events = CalendarAIAgent.distributeTasks(
      [task],
      [],
      start,
      end,
      [
        { startHour: 9, endHour: 11 },
        { startHour: 14, endHour: 17 },
      ]
    );
    expect(eventMinutesForTask(events, 'seg-1')).toBe(180);
    const hours = events.map((e) => e.start.getHours());
    expect(Math.min(...hours)).toBeGreaterThanOrEqual(9);
    expect(Math.max(...hours)).toBeLessThan(17);
  });

  it('schedules AI breakdown steps strictly in order', () => {
    vi.setSystemTime(new Date(2026, 3, 13, 9, 0, 0, 0));
    const start = new Date(2026, 3, 13, 0, 0, 0, 0);
    const end = new Date(2026, 3, 20, 0, 0, 0, 0);

    const due = new Date(2026, 3, 17, 0, 0, 0, 0);
    const s1 = baseTask({
      id: 'step-1',
      title: 'Step 1',
      estimatedDuration: 120,
      actualDurations: [],
      dueDate: due,
      planStepOrder: 1,
    });
    const s2 = baseTask({
      id: 'step-2',
      title: 'Step 2',
      estimatedDuration: 120,
      actualDurations: [],
      dueDate: due,
      planStepOrder: 2,
    });

    const events = CalendarAIAgent.distributeTasks(
      [s2, s1],
      [],
      start,
      end,
      [{ startHour: 9, endHour: 18 }],
      5,
      50
    );

    const first1 = Math.min(...events.filter((e) => e.taskId === 'step-1').map((e) => e.start.getTime()));
    const first2 = Math.min(...events.filter((e) => e.taskId === 'step-2').map((e) => e.start.getTime()));
    expect(first1).toBeLessThan(first2);

    const dueEnd = new Date(2026, 3, 17, 23, 59, 59, 999).getTime();
    for (const e of events) {
      expect(e.end.getTime()).toBeLessThanOrEqual(dueEnd + 1);
    }
  });

  it('does not interleave plan steps even when chunk sizes differ', () => {
    vi.setSystemTime(new Date(2026, 3, 13, 9, 0, 0, 0));
    const start = new Date(2026, 3, 13, 0, 0, 0, 0);
    const end = new Date(2026, 3, 20, 0, 0, 0, 0);

    const due = new Date(2026, 3, 17, 0, 0, 0, 0);
    // Step 1 creates chunks [50, 10]; Step 2 creates chunks [50, 50, 20].
    // A global "shorter-first" sort would try to place step-2's 20m before step-1's 50m,
    // which breaks step ordering.
    const s1 = baseTask({
      id: 'step-1b',
      title: 'Step 1b',
      estimatedDuration: 60,
      actualDurations: [],
      dueDate: due,
      planStepOrder: 1,
      priority: 'medium',
    });
    const s2 = baseTask({
      id: 'step-2b',
      title: 'Step 2b',
      estimatedDuration: 120,
      actualDurations: [],
      dueDate: due,
      planStepOrder: 2,
      priority: 'medium',
    });

    const events = CalendarAIAgent.distributeTasks(
      [s2, s1],
      [],
      start,
      end,
      [{ startHour: 9, endHour: 18 }],
      5,
      50
    );

    const step1Ends = events
      .filter((e) => e.taskId === 'step-1b')
      .map((e) => e.end.getTime());
    const step2Starts = events
      .filter((e) => e.taskId === 'step-2b')
      .map((e) => e.start.getTime());

    expect(step1Ends.length).toBeGreaterThan(0);
    expect(step2Starts.length).toBeGreaterThan(0);
    expect(Math.max(...step1Ends)).toBeLessThanOrEqual(Math.min(...step2Starts));
  });

  it('schedules later AI plan steps after an earlier step had partial chunk failure', () => {
    vi.setSystemTime(new Date(2026, 3, 13, 9, 0, 0, 0));
    const start = new Date(2026, 3, 13, 0, 0, 0, 0);
    const end = new Date(2026, 3, 27, 0, 0, 0, 0);
    const due = new Date(2026, 3, 25, 0, 0, 0, 0);
    // Step 1 splits into two chunks; step 2 is one chunk. Older logic skipped step 2 if chunk 2 of step 1 placed nothing.
    const s1 = baseTask({
      id: 'partial-1',
      title: 'Partial step 1',
      estimatedDuration: 70,
      actualDurations: [],
      dueDate: due,
      planStepOrder: 1,
    });
    const s2 = baseTask({
      id: 'partial-2',
      title: 'Step 2 after partial',
      estimatedDuration: 30,
      actualDurations: [],
      dueDate: due,
      planStepOrder: 2,
    });
    const events = CalendarAIAgent.distributeTasks(
      [s2, s1],
      [],
      start,
      end,
      [{ startHour: 9, endHour: 18 }],
      0,
      50
    );
    const ids = new Set(events.map((e) => e.taskId).filter(Boolean));
    expect(ids.has('partial-1')).toBe(true);
    expect(ids.has('partial-2')).toBe(true);
  });

  it('packs short AI plans into fewer days instead of stretching to the due horizon', () => {
    // 5 × 50min = 250min fits in one 9–18 workday → all on Monday, not Mon–Fri.
    vi.setSystemTime(new Date(2026, 3, 13, 9, 0, 0, 0));
    const start = new Date(2026, 3, 13, 0, 0, 0, 0);
    const end = new Date(2026, 3, 20, 23, 59, 59, 999);

    const steps = [1, 2, 3, 4, 5].map((order) =>
      baseTask({
        id: `spread-${order}`,
        title: `Step ${order}`,
        estimatedDuration: 50,
        actualDurations: [],
        planStepOrder: order,
        planId: 'spread-plan',
      })
    );

    const events = CalendarAIAgent.distributeTasks(
      steps,
      [],
      start,
      end,
      [{ startHour: 9, endHour: 18 }],
      0,
      50
    );

    const firstStartByTask = new Map<string, Date>();
    for (const e of events) {
      if (!e.taskId) continue;
      const prev = firstStartByTask.get(e.taskId);
      if (!prev || e.start < prev) {
        firstStartByTask.set(e.taskId, e.start);
      }
    }
    expect(firstStartByTask.size).toBe(5);
    const startDays = [...firstStartByTask.values()].map((d) => d.getDay());
    expect(new Set(startDays).size).toBe(1);
    expect(startDays[0]).toBe(1); // Monday

    const first1 = Math.min(
      ...events.filter((e) => e.taskId === 'spread-1').map((e) => e.start.getTime())
    );
    const first5 = Math.min(
      ...events.filter((e) => e.taskId === 'spread-5').map((e) => e.start.getTime())
    );
    expect(first1).toBeLessThanOrEqual(first5);
  });

  it('packs AI plan steps early and still finishes before a far due date', () => {
    vi.setSystemTime(new Date(2026, 6, 20, 9, 0, 0, 0)); // Mon Jul 20, 2026
    const start = new Date(2026, 6, 20, 0, 0, 0, 0);
    const end = new Date(2026, 7, 15, 23, 59, 59, 999);
    const due = new Date(2026, 7, 7, 0, 0, 0, 0); // Aug 7

    const step = baseTask({
      id: 'due-aug-7',
      title: 'Final draft',
      estimatedDuration: 60,
      actualDurations: [],
      dueDate: due,
      planStepOrder: 1,
      planId: 'due-plan',
    });

    const events = CalendarAIAgent.distributeTasks(
      [step],
      [],
      start,
      end,
      [{ startHour: 9, endHour: 18 }],
      0,
      50
    );

    expect(events.length).toBeGreaterThan(0);
    const first = events.find((e) => e.taskId === 'due-aug-7');
    expect(first).toBeDefined();
    expect(first!.start.getFullYear()).toBe(2026);
    expect(first!.start.getMonth()).toBe(6);
    expect(first!.start.getDate()).toBe(20);
    expect(first!.end.getTime()).toBeLessThanOrEqual(
      new Date(2026, 7, 7, 23, 59, 59, 999).getTime()
    );
  });

  it('still schedules on the next weekday when Friday work hours are over', () => {
    vi.setSystemTime(new Date(2026, 6, 31, 19, 0, 0, 0)); // Fri Jul 31, 2026 7pm
    const start = new Date(2026, 6, 31, 0, 0, 0, 0);
    const end = new Date(2026, 7, 14, 23, 59, 59, 999);

    const steps = [1, 2].map((order) =>
      baseTask({
        id: `fri-${order}`,
        title: `Step ${order}`,
        estimatedDuration: 60,
        actualDurations: [],
        dueDate: new Date(2026, 6, 31, 0, 0, 0, 0), // due "today" but day is over
        planStepOrder: order,
        planId: 'fri-plan',
      })
    );

    const events = CalendarAIAgent.distributeTasks(
      steps,
      [],
      start,
      end,
      [{ startHour: 9, endHour: 18 }],
      0,
      50
    );

    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.start.getDay() === 1)).toBe(true); // Monday
    expect(events[0].start.getDate()).toBe(3); // Aug 3, 2026
  });

  it('spreads longer AI plans across multiple weekdays when work needs more than one day', () => {
    vi.setSystemTime(new Date(2026, 3, 13, 9, 0, 0, 0));
    const start = new Date(2026, 3, 13, 0, 0, 0, 0);
    const end = new Date(2026, 3, 17, 23, 59, 59, 999);

    // 10 × 300min = 3000min; 9h/day → needs ~6 days but only 5 weekdays available.
    const steps = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((order) =>
      baseTask({
        id: `ten-${order}`,
        title: `Step ${order}`,
        estimatedDuration: 300,
        actualDurations: [],
        planStepOrder: order,
        planId: 'ten-plan',
      })
    );

    const events = CalendarAIAgent.distributeTasks(
      steps,
      [],
      start,
      end,
      [{ startHour: 9, endHour: 18 }],
      0,
      50
    );

    const counts = new Map<number, number>();
    const seenTask = new Set<string>();
    for (const e of events) {
      if (!e.taskId || seenTask.has(e.taskId)) continue;
      seenTask.add(e.taskId);
      const day = e.start.getDay();
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    expect(seenTask.size).toBeGreaterThan(0);
    expect([...counts.keys()].length).toBeGreaterThan(1);
  });

  it('respects due date cap', () => {
    vi.setSystemTime(new Date(2026, 3, 13, 9, 0, 0, 0));
    const start = new Date(2026, 3, 13, 0, 0, 0, 0);
    const end = new Date(2026, 3, 20, 0, 0, 0, 0);
    const due = new Date(2026, 3, 14, 0, 0, 0, 0);
    const task = baseTask({
      title: 'DueSoon',
      id: 'due-soon',
      estimatedDuration: 240,
      dueDate: due,
      actualDurations: [],
    });
    const events = CalendarAIAgent.distributeTasks([task], [], start, end, [{ startHour: 9, endHour: 18 }]);
    for (const e of events) {
      expect(e.end.getTime()).toBeLessThanOrEqual(
        new Date(2026, 3, 14, 23, 59, 59, 999).getTime() + 1
      );
    }
  });

  it('reports unmet minutes when work hours are too short', () => {
    vi.setSystemTime(new Date(2026, 3, 13, 9, 0, 0, 0));
    const start = new Date(2026, 3, 13, 0, 0, 0, 0);
    const end = new Date(2026, 3, 13, 23, 59, 59, 999);
    const due = new Date(2026, 3, 13, 0, 0, 0, 0);
    const task = baseTask({
      id: 'overflow-1',
      title: 'Too much for today',
      estimatedDuration: 300,
      dueDate: due,
      actualDurations: [],
      planStepOrder: 1,
      planId: 'ov',
    });
    // Only 2 work hours on the due day → cannot place 300m.
    const events = CalendarAIAgent.distributeTasks(
      [task],
      [],
      start,
      end,
      [{ startHour: 9, endHour: 11 }],
      0,
      50
    );
    const unmet = CalendarAIAgent.measureUnmetSchedule([task], events);
    expect(unmet.length).toBe(1);
    expect(unmet[0].taskId).toBe('overflow-1');
    expect(unmet[0].unmetMinutes).toBeGreaterThanOrEqual(15);
  });

  it('extends past work end but never before work start', () => {
    vi.setSystemTime(new Date(2026, 3, 13, 9, 0, 0, 0));
    const start = new Date(2026, 3, 13, 0, 0, 0, 0);
    const end = new Date(2026, 3, 14, 23, 59, 59, 999);
    const due = new Date(2026, 3, 14, 0, 0, 0, 0);
    const task = baseTask({
      id: 'evening-1',
      title: 'Evening work',
      estimatedDuration: 600,
      dueDate: due,
      actualDurations: [],
    });
    const work = [{ startHour: 9, endHour: 11 }];
    const narrow = CalendarAIAgent.distributeTasks(
      [task],
      [],
      start,
      end,
      work,
      0,
      50
    );
    const extendedSegs = CalendarAIAgent.extendWorkSegmentsPastEnd(work);
    expect(extendedSegs).toEqual([{ startHour: 9, endHour: 24 }]);

    const extended = CalendarAIAgent.distributeTasks(
      [task],
      [],
      start,
      end,
      extendedSegs,
      0,
      50
    );
    expect(eventMinutesForTask(narrow, 'evening-1')).toBeLessThan(
      eventMinutesForTask(extended, 'evening-1')
    );
    for (const e of extended) {
      expect(e.start.getHours()).toBeGreaterThanOrEqual(9);
    }
    // Day 2 must also start at work hour, not midnight/1am.
    const tuesday = extended.filter((e) => e.start.getDate() === 14);
    expect(tuesday.length).toBeGreaterThan(0);
    expect(Math.min(...tuesday.map((e) => e.start.getHours()))).toBeGreaterThanOrEqual(9);
  });
});

describe('CalendarAIAgent.assignPlanStepsEvenlyAcrossDays', () => {
  it('splits steps evenly with remainder on earlier days', () => {
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

  it('puts one step on each day when counts match', () => {
    const assigned = CalendarAIAgent.assignPlanStepsEvenlyAcrossDays(
      ['1', '2', '3', '4', '5'],
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
    );
    expect([...assigned.values()]).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  });
});

describe('CalendarAIAgent.getTaskDurationStats', () => {
  it('returns defaults when no actuals', () => {
    const t = baseTask({ title: 'A', id: '1', estimatedDuration: 90, actualDurations: [] });
    const [s] = CalendarAIAgent.getTaskDurationStats([t]);
    expect(s.averageDuration).toBe(90);
    expect(s.completionCount).toBe(0);
  });

  it('computes stats from actuals', () => {
    const t = baseTask({ title: 'A', id: '1', actualDurations: [10, 30, 50] });
    const [s] = CalendarAIAgent.getTaskDurationStats([t]);
    expect(s.averageDuration).toBe(30);
    expect(s.minDuration).toBe(10);
    expect(s.maxDuration).toBe(50);
    expect(s.completionCount).toBe(3);
  });
});

describe('CalendarAIAgent.recordTaskCompletion', () => {
  it('appends actual duration and sets completedAt', () => {
    const t = baseTask({ title: 'A', id: '1', actualDurations: [10] });
    const done = CalendarAIAgent.recordTaskCompletion(t, 25);
    expect(done.actualDurations).toEqual([10, 25]);
    expect(done.completedAt).toBeInstanceOf(Date);
  });
});
