import { Task, CalendarEvent, TimeSlot, TaskDurationStats, WorkSegment } from '@/types';
import { endOfLocalCalendarDay } from '@/lib/date-utils';
import { isAllDayLikeEvent } from '@/lib/calendar-event-utils';
import { SCHEDULE_MAX_HORIZON_DAYS } from '@/lib/schedule-constants';

/**
 * AI Agent that learns task durations and distributes tasks across calendar.
 *
 * Scheduling modes:
 * - Manual tasks: spread across weekdays up to the due date by (a) filling focus-chunks fully,
 *   (b) preferring days with lower load for that task, and (c) enforcing a per-day cap derived
 *   from totalMinutes / weekdayCount (relaxed only when nothing fits).
 * - AI breakdown steps (planStepOrder): scheduled strictly step-by-step in order; later steps
 *   never occur before earlier steps. Placement prefers the calendar week of `startDate`, and
 *   spreads plan load across weekdays through the due date (soft per-day cap from
 *   totalPlanMinutes / weekdayCount) so early packing does not leave the day before due empty.
 *   Chunks never start on or after the task due date (end of that local calendar day). If a step
 *   cannot be placed at all, remaining steps are skipped.
 */
export class CalendarAIAgent {
  /**
   * Coerce UI / API duration input to a positive integer minute value (fallback 60).
   */
  static coerceEstimatedMinutes(raw: unknown): number {
    if (raw == null) return 60;
    const n =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? parseFloat(String(raw).trim())
          : NaN;
    if (!Number.isFinite(n) || n <= 0) return 60;
    const rounded = Math.round(n);
    return Math.min(Math.max(rounded, 15), 60 * 24 * 60);
  }

  /**
   * Calculate average duration for a task based on historical data
   */
  static calculateTaskDuration(task: Task): number {
    // For work not done yet, always plan from the user's estimate when they set one.
    // Otherwise a short first completion (e.g. 30m) would shrink all future schedules.
    const estRaw = task.estimatedDuration as unknown;
    const estNum =
      typeof estRaw === 'string'
        ? parseFloat(String(estRaw).trim())
        : typeof estRaw === 'number'
          ? estRaw
          : NaN;
    if (!task.completedAt && !Number.isNaN(estNum) && estNum > 0) {
      return estNum;
    }

    if (task.actualDurations.length === 0) {
      if (!Number.isNaN(estNum) && estNum > 0) {
        return estNum;
      }
      return 60;
    }

    const sum = task.actualDurations.reduce((acc, duration) => acc + duration, 0);
    return Math.round(sum / task.actualDurations.length);
  }

  /**
   * Get duration statistics for all tasks
   */
  static getTaskDurationStats(tasks: Task[]): TaskDurationStats[] {
    return tasks.map(task => {
      const durations = task.actualDurations;
      if (durations.length === 0) {
        return {
          taskId: task.id,
          averageDuration: task.estimatedDuration || 60,
          minDuration: task.estimatedDuration || 60,
          maxDuration: task.estimatedDuration || 60,
          completionCount: 0,
        };
      }

      return {
        taskId: task.id,
        averageDuration: Math.round(
          durations.reduce((acc, d) => acc + d, 0) / durations.length
        ),
        minDuration: Math.min(...durations),
        maxDuration: Math.max(...durations),
        completionCount: durations.length,
      };
    });
  }

  /**
   * Split duration into focus-minute chunks (e.g. 120 min, focus 50 → [50, 50, 20])
   */
  static chunkDurationByFocus(duration: number, focusMinutes: number): number[] {
    const chunks: number[] = [];
    let remaining = duration;
    while (remaining > 0) {
      const piece = Math.min(remaining, focusMinutes);
      chunks.push(piece);
      remaining -= piece;
    }
    // Merge a trailing fragment under 15m into the previous chunk (15m is the minimum gap size).
    if (chunks.length >= 2) {
      const tail = chunks[chunks.length - 1];
      if (tail > 0 && tail < 15) {
        chunks[chunks.length - 2] += tail;
        chunks.pop();
      }
    }
    return chunks;
  }

  /**
   * Find all empty time slots in the calendar
   * breakAfterEventsMinutes: gap after each event before next slot can start
   */
  static findEmptySlots(
    existingEvents: CalendarEvent[],
    startDate: Date,
    endDate: Date,
    workStartHour: number = 9,
    workEndHour: number = 18,
    breakAfterEventsMinutes: number = 0
  ): TimeSlot[] {
    const slots: TimeSlot[] = [];
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
      // Skip weekends (optional - you can make this configurable)
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        currentDate.setDate(currentDate.getDate() + 1);
        continue;
      }

      // Create time slots for each day
      const dayStart = new Date(currentDate);
      dayStart.setHours(workStartHour, 0, 0, 0);

      const dayEnd = new Date(currentDate);
      dayEnd.setHours(workEndHour, 0, 0, 0);

      // Get events for this day
      const dayEvents = existingEvents.filter(event => {
        const eventDate = new Date(event.start);
        return (
          eventDate.getDate() === currentDate.getDate() &&
          eventDate.getMonth() === currentDate.getMonth() &&
          eventDate.getFullYear() === currentDate.getFullYear()
        );
      });

      // Sort events by start time
      dayEvents.sort((a, b) => a.start.getTime() - b.start.getTime());

      // Find gaps between events, clipping each event to [dayStart, dayEnd) so
      // all-day / long events don't break gap detection inside the work window.
      let currentTime = new Date(dayStart);

      for (const event of dayEvents) {
        // Treat all-day events as informational (e.g. Canvas due dates) and do not block work time.
        if (isAllDayLikeEvent(event)) {
          continue;
        }
        // Entirely before this work window
        if (event.end <= dayStart) {
          continue;
        }
        // Entirely after this work window — remaining day is free
        if (event.start >= dayEnd) {
          break;
        }

        const blockStart = event.start < dayStart ? dayStart : event.start;
        const blockEnd = event.end > dayEnd ? dayEnd : event.end;

        if (currentTime < blockStart) {
          const slotEnd = new Date(blockStart);
          const duration = Math.round((slotEnd.getTime() - currentTime.getTime()) / (1000 * 60));

          if (duration >= 15) {
            slots.push({
              start: new Date(currentTime),
              end: slotEnd,
              duration,
            });
          }
        }

        const afterBreak = new Date(blockEnd.getTime() + breakAfterEventsMinutes * 60 * 1000);
        if (afterBreak > currentTime) {
          currentTime = afterBreak;
        }
      }

      // Check for slot after last event
      if (currentTime < dayEnd) {
        const duration = Math.round((dayEnd.getTime() - currentTime.getTime()) / (1000 * 60));
        if (duration >= 15) {
          slots.push({
            start: new Date(currentTime),
            end: new Date(dayEnd),
            duration,
          });
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return slots;
  }

  /**
   * Merge overlapping or identical free slots so the same calendar window is never
   * listed twice (which would let the scheduler place multiple chunks on duplicate rows
   * and collapse visually to a shorter block on the calendar).
   */
  private static mergeOverlappingFreeSlots(slots: TimeSlot[]): TimeSlot[] {
    if (slots.length === 0) return [];
    const sorted = [...slots].sort((a, b) => a.start.getTime() - b.start.getTime());
    const out: TimeSlot[] = [];
    for (const s of sorted) {
      const cur = { start: new Date(s.start), end: new Date(s.end), duration: 0 };
      cur.duration = Math.round((cur.end.getTime() - cur.start.getTime()) / (1000 * 60));
      const last = out[out.length - 1];
      if (last && cur.start.getTime() < last.end.getTime()) {
        const newEndMs = Math.max(last.end.getTime(), cur.end.getTime());
        last.end = new Date(newEndMs);
        last.duration = Math.round((last.end.getTime() - last.start.getTime()) / (1000 * 60));
      } else {
        out.push(cur);
      }
    }
    return out;
  }

  /**
   * Normalize work segments: clamp to valid ranges, drop invalid segments,
   * and merge overlapping or touching segments so scheduling never double-books.
   */
  private static normalizeWorkSegments(workSegments: WorkSegment[]): WorkSegment[] {
    const fallback: WorkSegment[] = [{ startHour: 9, endHour: 18 }];

    if (!workSegments || workSegments.length === 0) {
      return fallback;
    }

    const segments = workSegments
      .map((seg) => {
        const startHour = Math.max(0, Math.min(23, seg.startHour));
        // Allow 24 so a full-day block can run through 23:59 (outside-hours overflow).
        const endHour = Math.max(0, Math.min(24, seg.endHour));
        return { startHour, endHour };
      })
      .filter((seg) => seg.startHour < seg.endHour)
      .sort((a, b) => a.startHour - b.startHour);

    if (segments.length === 0) {
      return fallback;
    }

    const merged: WorkSegment[] = [];
    for (const seg of segments) {
      const last = merged[merged.length - 1];
      if (!last) {
        merged.push({ ...seg });
      } else if (seg.startHour <= last.endHour) {
        // Overlapping or touching segments → merge into a single block
        last.endHour = Math.max(last.endHour, seg.endHour);
      } else {
        merged.push({ ...seg });
      }
    }

    return merged;
  }

  /** True if eventStart falls inside [segment.start, segment.end) using minute precision. */
  private static eventStartWithinWorkSegments(eventStart: Date, segments: WorkSegment[]): boolean {
    const mins = eventStart.getHours() * 60 + eventStart.getMinutes();
    return segments.some((seg) => {
      const startM = seg.startHour * 60;
      const endM = seg.endHour * 60;
      return mins >= startM && mins < endM;
    });
  }

  /**
   * When the user allows scheduling past working hours: keep configured starts
   * (never earlier than work-hour start) and extend the last block through end of day.
   * Following days still begin at the normal work start — mornings before that stay empty.
   */
  static extendWorkSegmentsPastEnd(workSegments: WorkSegment[]): WorkSegment[] {
    const normalized = this.normalizeWorkSegments(workSegments);
    if (normalized.length === 0) {
      return [{ startHour: 9, endHour: 24 }];
    }
    const extended = normalized.map((seg, index) =>
      index === normalized.length - 1 ? { ...seg, endHour: 24 } : { ...seg }
    );
    return this.normalizeWorkSegments(extended);
  }

  /**
   * Minutes still needed for each incomplete task after a scheduling pass.
   * Sub-15m leftovers are ignored (same floor as placement).
   */
  static measureUnmetSchedule(
    tasks: Task[],
    scheduledEvents: CalendarEvent[]
  ): { taskId: string; unmetMinutes: number }[] {
    const placed = new Map<string, number>();
    for (const event of scheduledEvents) {
      if (!event.taskId) continue;
      const mins = Math.round((event.end.getTime() - event.start.getTime()) / (1000 * 60));
      placed.set(event.taskId, (placed.get(event.taskId) ?? 0) + mins);
    }

    const unmet: { taskId: string; unmetMinutes: number }[] = [];
    const seen = new Set<string>();
    for (const task of tasks) {
      if (task.completedAt || seen.has(task.id)) continue;
      seen.add(task.id);
      const need = this.calculateTaskDuration(task);
      const got = placed.get(task.id) ?? 0;
      const rem = need - got;
      if (rem >= 15) {
        unmet.push({ taskId: task.id, unmetMinutes: rem });
      }
    }
    return unmet;
  }

  /** End of the task's due calendar day (local). Scheduled work must end by this instant. */
  private static getTaskDueDeadline(task: Task): Date | null {
    if (!task.dueDate) return null;
    return endOfLocalCalendarDay(task.dueDate);
  }

  /**
   * End of the date range passed to {@link findEmptySlots} / {@link distributeTasks}.
   * Always includes at least `minHorizonDays` after `rangeStart` (default two weeks) so tasks
   * without a due still see a reasonable window. If any task has a `dueDate`, extends through the
   * latest due (end of that local day), capped at `maxHorizonDays` to bound work in `findEmptySlots`.
   */
  static computeScheduleEndDate(
    tasks: Task[],
    rangeStart: Date = new Date(),
    minHorizonDays: number = 14,
    maxHorizonDays: number = SCHEDULE_MAX_HORIZON_DAYS
  ): Date {
    const start = new Date(rangeStart);
    start.setHours(0, 0, 0, 0);

    const minEnd = new Date(start);
    minEnd.setDate(minEnd.getDate() + minHorizonDays);
    minEnd.setHours(23, 59, 59, 999);

    let latestDueMs = 0;
    for (const t of tasks) {
      const d = this.getTaskDueDeadline(t);
      if (d) {
        latestDueMs = Math.max(latestDueMs, d.getTime());
      }
    }

    const capEnd = new Date(start);
    capEnd.setDate(capEnd.getDate() + maxHorizonDays);
    capEnd.setHours(23, 59, 59, 999);

    const mergedMs = Math.max(minEnd.getTime(), latestDueMs || minEnd.getTime());
    const merged = new Date(mergedMs);
    return merged.getTime() > capEnd.getTime() ? capEnd : merged;
  }

  private static taskColor(task: Task): string {
    switch (task.priority) {
      case 'high':
        return '#fcd2d2'; // red-50
      case 'medium':
        return '#fff6d0'; // amber-50
      case 'low':
        return '#e0ffe2'; // emerald-50
      default:
        return '#f9fafb'; // gray-50
    }
  }

  private static localDayKey(d: Date): string {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  /** Week starts Sunday 00:00 local (default react-big-calendar week). */
  private static startOfSundayWeek(day: Date): Date {
    const x = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const dow = x.getDay();
    x.setDate(x.getDate() - dow);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  /** Local calendar weekdays from `a` through `b` (date parts only, inclusive). */
  private static listWeekdayKeysBetweenInclusive(a: Date, b: Date): string[] {
    const out: string[] = [];
    const cur = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const end = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    while (cur.getTime() <= end.getTime()) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6) {
        out.push(this.localDayKey(cur));
      }
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  /**
   * Distribute tasks across available calendar slots
   * breakAfterEventsMinutes: gap after each event/task before next can be scheduled
   * focusMinutes: max chunk size (tasks longer than this get split)
   */
  static distributeTasks(
    tasks: Task[],
    existingEvents: CalendarEvent[],
    startDate: Date,
    endDate: Date,
    workSegments: WorkSegment[] = [{ startHour: 9, endHour: 18 }],
    breakAfterEventsMinutes: number = 0,
    focusMinutes: number = 50
  ): CalendarEvent[] {
    const seen = new Set<string>();
    const unique = tasks.filter((t) => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    const priorityRank = (t: Task) =>
      t.priority === 'high' ? 3 : t.priority === 'medium' ? 2 : 1;

    // Ensure AI breakdown steps run first, strictly ordered.
    const withPlan = unique
      .filter((t) => t.planStepOrder != null)
      .sort((a, b) => (a.planStepOrder! - b.planStepOrder!));
    const withoutPlan = unique
      .filter((t) => t.planStepOrder == null)
      .sort((a, b) => priorityRank(b) - priorityRank(a));
    const taskOrder = [...withPlan, ...withoutPlan];

    const taskChunks: {
      task: Task;
      duration: number;
      partIndex: number;
      totalParts: number;
      priority: number;
      usesPlanOrder: boolean;
    }[] = [];
    for (const task of taskOrder) {
      const fullDuration = this.calculateTaskDuration(task);
      const priority = task.priority === 'high' ? 3 : task.priority === 'medium' ? 2 : 1;
      const usesPlanOrder = task.planStepOrder != null;
      const chunks = this.chunkDurationByFocus(fullDuration, focusMinutes);
      chunks.forEach((duration, partIndex) => {
        taskChunks.push({
          task,
          duration,
          partIndex,
          totalParts: chunks.length,
          priority,
          usesPlanOrder,
        });
      });
    }

    // Keep AI breakdown steps strictly ordered (step-by-step, then part-by-part).
    // Non-plan tasks can still be optimized for fit by priority + shorter-first.
    const planChunks = taskChunks.filter((c) => c.usesPlanOrder);
    const nonPlanChunks = taskChunks.filter((c) => !c.usesPlanOrder);
    nonPlanChunks.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.duration - b.duration;
    });
    const orderedChunks = [...planChunks, ...nonPlanChunks];

    const normalizedSegments = this.normalizeWorkSegments(workSegments);

    let emptySlots: TimeSlot[] = [];
    for (const segment of normalizedSegments) {
      const segmentSlots = this.findEmptySlots(
        existingEvents,
        startDate,
        endDate,
        segment.startHour,
        segment.endHour,
        breakAfterEventsMinutes
      );
      emptySlots.push(...segmentSlots);
    }

    const now = new Date();
    const futureSlots: TimeSlot[] = [];

    for (const slot of emptySlots) {
      if (slot.end <= now) {
        continue;
      }

      const slotStart = slot.start < now ? new Date(now) : slot.start;
      const duration = Math.round(
        (slot.end.getTime() - slotStart.getTime()) / (1000 * 60)
      );

      if (duration >= 15) {
        futureSlots.push({
          start: slotStart,
          end: slot.end,
          duration,
        });
      }
    }

    emptySlots = this.mergeOverlappingFreeSlots(
      futureSlots.sort((a, b) => a.start.getTime() - b.start.getTime())
    );

    const planDayMid = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const planAnchorWeekStart = this.startOfSundayWeek(planDayMid);
    const planAnchorWeekEndEx = new Date(planAnchorWeekStart);
    planAnchorWeekEndEx.setDate(planAnchorWeekEndEx.getDate() + 7);
    const planWeekLoads = new Map<string, number>();

    // Soft per-day cap for the whole AI plan so steps spread through weekdays up to due
    // (e.g. Fri due still gets Thu work) instead of packing Mon–Wed only.
    let planSpreadWeekdays: string[] = [];
    let planMaxPerDay: number | null = null;
    if (planChunks.length > 0) {
      const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const startMid = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        startDate.getDate()
      );
      const planStart = startMid.getTime() > todayMid.getTime() ? startMid : todayMid;
      let latestPlanDue: Date | null = null;
      let totalPlanMinutes = 0;
      const seenPlanTasks = new Set<string>();
      for (const { task } of planChunks) {
        if (!seenPlanTasks.has(task.id)) {
          seenPlanTasks.add(task.id);
          totalPlanMinutes += this.calculateTaskDuration(task);
        }
        const d = this.getTaskDueDeadline(task);
        if (d && (!latestPlanDue || d.getTime() > latestPlanDue.getTime())) {
          latestPlanDue = d;
        }
      }
      const lastInstant = latestPlanDue
        ? new Date(Math.min(endDate.getTime(), latestPlanDue.getTime()))
        : endDate;
      const planEnd = new Date(
        lastInstant.getFullYear(),
        lastInstant.getMonth(),
        lastInstant.getDate()
      );
      planSpreadWeekdays = this.listWeekdayKeysBetweenInclusive(planStart, planEnd);
      if (planSpreadWeekdays.length === 0) {
        planSpreadWeekdays = [this.localDayKey(planStart)];
      }
      planMaxPerDay = Math.max(
        15,
        Math.ceil(totalPlanMinutes / Math.max(1, planSpreadWeekdays.length))
      );
    }

    const scheduledEvents: CalendarEvent[] = [];
    let scheduleIdSeq = 0;
    const nextId = (taskId: string, partIndex: number, slotIdx: number, tag: string) =>
      `scheduled-${taskId}-${++scheduleIdSeq}-s${slotIdx}-p${partIndex}-${tag}`;

    const loadsByTask = new Map<string, Map<string, number>>();
    const rrByTask = new Map<string, number>();
    const weekdayCycleByTask = new Map<string, string[]>();
    const maxPerDayByTask = new Map<string, number>();
    let globalCursor = new Date(now.getTime());
    let prevPlanTaskId: string | null = null;
    /** Plan-step tasks that received at least one scheduled block (any chunk). */
    const planTasksWithScheduledTime = new Set<string>();
    let skipRemainingPlanSteps = false;
    let planDayRr = 0;

    const getDayLoads = (taskId: string): Map<string, number> => {
      let m = loadsByTask.get(taskId);
      if (!m) {
        m = new Map();
        loadsByTask.set(taskId, m);
      }
      return m;
    };

    for (const { task, duration: chunkMinutes, partIndex, totalParts, usesPlanOrder } of orderedChunks) {
      const dueEnd = this.getTaskDueDeadline(task);
      const displayTitle =
        totalParts > 1 ? `${task.title} (Part ${partIndex + 1}/${totalParts})` : task.title;

      // AI breakdown steps must remain sequential across *steps* (tasks), not individual focus chunks.
      // Only skip later steps if the *previous* step had zero scheduled time in total — not because
      // one middle chunk failed while other chunks for the same step already placed.
      if (usesPlanOrder) {
        if (skipRemainingPlanSteps) {
          continue;
        }
        if (prevPlanTaskId !== null && prevPlanTaskId !== task.id) {
          if (!planTasksWithScheduledTime.has(prevPlanTaskId)) {
            skipRemainingPlanSteps = true;
            continue;
          }
        }
        prevPlanTaskId = task.id;
      } else {
        prevPlanTaskId = null;
        skipRemainingPlanSteps = false;
      }

      let weekdayCycle: string[] | null = null;
      let maxPerDay: number | null = null;
      if (!usesPlanOrder) {
        weekdayCycle = weekdayCycleByTask.get(task.id) ?? null;
        maxPerDay = maxPerDayByTask.get(task.id) ?? null;
        if (!weekdayCycle || maxPerDay == null) {
          const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const startMid = new Date(
            startDate.getFullYear(),
            startDate.getMonth(),
            startDate.getDate()
          );
          const planStart = startMid.getTime() > todayMid.getTime() ? startMid : todayMid;
          const lastInstant = dueEnd
            ? new Date(Math.min(endDate.getTime(), dueEnd.getTime()))
            : endDate;
          const planEnd = new Date(
            lastInstant.getFullYear(),
            lastInstant.getMonth(),
            lastInstant.getDate()
          );
          weekdayCycle = this.listWeekdayKeysBetweenInclusive(planStart, planEnd);
          if (weekdayCycle.length === 0) {
            weekdayCycle = [this.localDayKey(planStart)];
          }
          weekdayCycleByTask.set(task.id, weekdayCycle);

          const totalMinutes = this.calculateTaskDuration(task);
          maxPerDay = Math.ceil(totalMinutes / Math.max(1, weekdayCycle.length));
          maxPerDayByTask.set(task.id, maxPerDay);
        }
      }

      const dayLoads = getDayLoads(task.id);
      let remaining = chunkMinutes;
      let placeFrag = 0;
      let placedAnyThisChunk = false;

      while (remaining >= 15) {
        const rr = rrByTask.get(task.id) ?? 0;
        const prefDay =
          usesPlanOrder && planSpreadWeekdays.length > 0
            ? planSpreadWeekdays[planDayRr % planSpreadWeekdays.length]
            : !usesPlanOrder && weekdayCycle && weekdayCycle.length > 0
              ? weekdayCycle[rr % weekdayCycle.length]
              : null;

        type Cand = {
          i: number;
          use: number;
          start: Date;
          end: Date;
          dayKey: string;
          load: number;
          onPref: boolean;
          withinCap: boolean;
        };
        const cands: Cand[] = [];
        const candsRelaxed: Cand[] = [];

        for (let i = 0; i < emptySlots.length; i++) {
          const slot = emptySlots[i];
          if (dueEnd && dueEnd.getTime() <= slot.start.getTime()) {
            continue;
          }
          const slotEndCap =
            dueEnd && dueEnd.getTime() < slot.end.getTime() ? dueEnd : slot.end;
          const minStart = usesPlanOrder ? globalCursor : now;
          const effStart =
            slot.start.getTime() < minStart.getTime() ? new Date(minStart) : new Date(slot.start);
          if (effStart.getTime() >= slotEndCap.getTime()) {
            continue;
          }

          const avail = Math.round(
            (slotEndCap.getTime() - effStart.getTime()) / (1000 * 60)
          );
          if (avail < 15) {
            continue;
          }

          const dayKey = this.localDayKey(effStart);
          const load = usesPlanOrder
            ? planWeekLoads.get(dayKey) ?? 0
            : dayLoads.get(dayKey) ?? 0;
          const onPref = prefDay !== null && dayKey === prefDay;

          if (usesPlanOrder && planMaxPerDay != null) {
            const room = Math.max(0, planMaxPerDay - load);
            const useFull = Math.min(remaining, avail);
            if (useFull < 15) {
              continue;
            }
            if (room >= 15) {
              let use = Math.min(useFull, room);
              const leftover = remaining - use;
              // Absorb sub-15 remnants so soft caps don't drop minutes.
              if (leftover > 0 && leftover < 15) {
                use = useFull;
              }
              if (use >= 15) {
                cands.push({
                  i,
                  use,
                  start: effStart,
                  end: new Date(effStart.getTime() + use * 60 * 1000),
                  dayKey,
                  load,
                  onPref,
                  withinCap: true,
                });
              }
            } else {
              candsRelaxed.push({
                i,
                use: useFull,
                start: effStart,
                end: new Date(effStart.getTime() + useFull * 60 * 1000),
                dayKey,
                load,
                onPref,
                withinCap: false,
              });
            }
            continue;
          }

          const use = Math.min(remaining, avail);
          if (use < 15) {
            continue;
          }
          const withinCap = maxPerDay != null ? load + use <= maxPerDay : true;
          const row: Cand = {
            i,
            use,
            start: effStart,
            end: new Date(effStart.getTime() + use * 60 * 1000),
            dayKey,
            load,
            onPref,
            withinCap,
          };
          if (withinCap) {
            cands.push(row);
          } else {
            candsRelaxed.push(row);
          }
        }

        let pool = cands.length > 0 ? cands : candsRelaxed;
        if (pool.length === 0) {
          break;
        }

        if (dueEnd) {
          const dueCutoff = dueEnd.getTime();
          pool = pool.filter((c) => c.start.getTime() < dueCutoff);
          if (pool.length === 0) {
            break;
          }
        }

        if (usesPlanOrder) {
          let anchorWeekEnd = planAnchorWeekEndEx.getTime();
          if (dueEnd && dueEnd.getTime() < anchorWeekEnd) {
            anchorWeekEnd = dueEnd.getTime();
          }
          const inAnchorWeek = pool.filter(
            (c) =>
              c.start.getTime() >= planAnchorWeekStart.getTime() &&
              c.start.getTime() < anchorWeekEnd
          );
          if (inAnchorWeek.length > 0) {
            pool = inAnchorWeek;
          }
          pool.sort((a, b) => {
            if (a.onPref !== b.onPref) {
              return a.onPref ? -1 : 1;
            }
            const wa = planWeekLoads.get(a.dayKey) ?? 0;
            const wb = planWeekLoads.get(b.dayKey) ?? 0;
            if (wa !== wb) {
              return wa - wb;
            }
            return a.start.getTime() - b.start.getTime();
          });
        } else {
          pool.sort((a, b) => {
            if (a.load !== b.load) {
              return a.load - b.load;
            }
            if (a.onPref !== b.onPref) {
              return a.onPref ? -1 : 1;
            }
            return a.start.getTime() - b.start.getTime();
          });
        }

        const best = pool[0];
        rrByTask.set(task.id, (rrByTask.get(task.id) ?? 0) + 1);
        if (usesPlanOrder && planSpreadWeekdays.length > 0) {
          planDayRr += 1;
        }

        const slotRow = emptySlots[best.i];
        placeFrag += 1;
        scheduledEvents.push({
          id: nextId(task.id, partIndex, best.i, `g${placeFrag}`),
          title: displayTitle,
          start: best.start,
          end: best.end,
          taskId: task.id,
          isScheduled: true,
          color: this.taskColor(task),
        });

        dayLoads.set(best.dayKey, (dayLoads.get(best.dayKey) ?? 0) + best.use);
        remaining -= best.use;
        placedAnyThisChunk = true;
        if (usesPlanOrder) {
          planTasksWithScheduledTime.add(task.id);
          planWeekLoads.set(best.dayKey, (planWeekLoads.get(best.dayKey) ?? 0) + best.use);
        }

        const slotAfterBreak = new Date(
          best.end.getTime() + breakAfterEventsMinutes * 60 * 1000
        );
        if (slotAfterBreak.getTime() >= slotRow.end.getTime()) {
          emptySlots.splice(best.i, 1);
        } else {
          const remainingTime = Math.round(
            (slotRow.end.getTime() - slotAfterBreak.getTime()) / (1000 * 60)
          );
          if (remainingTime < 15) {
            emptySlots.splice(best.i, 1);
          } else {
            emptySlots[best.i] = {
              start: slotAfterBreak,
              end: slotRow.end,
              duration: remainingTime,
            };
          }
        }

        if (usesPlanOrder) {
          globalCursor = new Date(slotAfterBreak.getTime());
        }
      }

    }

    const tasksById = new Map<string, Task>();
    for (const task of unique) {
      tasksById.set(task.id, task);
    }

    const eventsByTaskId = new Map<string, CalendarEvent[]>();
    for (const event of scheduledEvents) {
      if (!event.taskId) continue;
      const group = eventsByTaskId.get(event.taskId) || [];
      group.push(event);
      eventsByTaskId.set(event.taskId, group);
    }

    for (const [taskId, taskEvents] of eventsByTaskId.entries()) {
      const task = tasksById.get(taskId);
      if (!task) continue;

      taskEvents.sort((a, b) => a.start.getTime() - b.start.getTime());
      const totalPartsFinal = taskEvents.length;

      for (let index = 0; index < taskEvents.length; index++) {
        const event = taskEvents[index];
        event.title =
          totalPartsFinal > 1
            ? `${task.title} (Part ${index + 1}/${totalPartsFinal})`
            : task.title;
      }
    }

    // Use the same instant as slot clamping (`now` above), not `new Date()` here.
    // Otherwise any block starting at that `now` can be dropped when real time advances by 1ms+.
    const constrainedEvents = scheduledEvents.filter((event) => {
      if (event.start.getTime() < now.getTime()) return false;

      return this.eventStartWithinWorkSegments(event.start, normalizedSegments);
    });

    return constrainedEvents;
  }

  /**
   * Update task with actual completion duration
   */
  static recordTaskCompletion(task: Task, actualDuration: number): Task {
    return {
      ...task,
      actualDurations: [...task.actualDurations, actualDuration],
      completedAt: new Date(),
    };
  }
}
