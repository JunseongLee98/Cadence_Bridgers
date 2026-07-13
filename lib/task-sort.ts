import type { Task } from '@/types';

const PRIORITY_RANK: Record<Task['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

function dueTime(task: Task): number | null {
  if (!task.dueDate) return null;
  const t = task.dueDate instanceof Date ? task.dueDate.getTime() : new Date(task.dueDate).getTime();
  return Number.isFinite(t) ? t : null;
}

function createdTime(task: Task): number {
  const t = task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

function completedTime(task: Task): number {
  if (!task.completedAt) return 0;
  const t =
    task.completedAt instanceof Date
      ? task.completedAt.getTime()
      : new Date(task.completedAt).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Active task list order:
 * 1. Earliest due date first (no due date last)
 * 2. Same due: keep AI plan steps together (by planId), ordered by planStepOrder
 * 3. Higher priority first
 * 4. Older createdAt first
 */
export function compareActiveTasks(a: Task, b: Task): number {
  const aDue = dueTime(a);
  const bDue = dueTime(b);
  if (aDue !== null && bDue !== null && aDue !== bDue) return aDue - bDue;
  if (aDue !== null && bDue === null) return -1;
  if (aDue === null && bDue !== null) return 1;

  const aPlan = a.planId ?? '';
  const bPlan = b.planId ?? '';
  if (aPlan && bPlan && aPlan === bPlan) {
    const aStep = a.planStepOrder ?? Number.MAX_SAFE_INTEGER;
    const bStep = b.planStepOrder ?? Number.MAX_SAFE_INTEGER;
    if (aStep !== bStep) return aStep - bStep;
  } else if (aPlan !== bPlan) {
    // Different plans (or one unplanned): keep plans contiguous by earliest member proxy —
    // compare planId strings only when both have plans; unplanned after planned at same due.
    if (aPlan && !bPlan) return -1;
    if (!aPlan && bPlan) return 1;
    if (aPlan && bPlan) return aPlan.localeCompare(bPlan);
  }

  const pr = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (pr !== 0) return pr;

  return createdTime(a) - createdTime(b);
}

/**
 * Completed task list order:
 * 1. Most recently completed first
 * 2. Then same rules as active (due → plan step → priority → created)
 */
export function compareCompletedTasks(a: Task, b: Task): number {
  const byCompleted = completedTime(b) - completedTime(a);
  if (byCompleted !== 0) return byCompleted;
  return compareActiveTasks(a, b);
}

export function sortActiveTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(compareActiveTasks);
}

export function sortCompletedTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(compareCompletedTasks);
}
