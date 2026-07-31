import type { Task } from '@/types';

let seq = 0;

export function makeTask(partial: Partial<Task> & Pick<Task, 'title'>): Task {
  const id = partial.id ?? `task-${++seq}`;
  return {
    id,
    title: partial.title,
    description: partial.description,
    estimatedDuration: partial.estimatedDuration,
    actualDurations: partial.actualDurations ?? [],
    priority: partial.priority ?? 'medium',
    category: partial.category,
    dueDate: partial.dueDate,
    createdAt: partial.createdAt ?? new Date('2026-01-01T12:00:00'),
    completedAt: partial.completedAt,
    planStepOrder: partial.planStepOrder,
    planId: partial.planId,
    procedureTitle: partial.procedureTitle,
    procedureDescription: partial.procedureDescription,
    workAmount: partial.workAmount,
    workUnit: partial.workUnit,
  };
}
