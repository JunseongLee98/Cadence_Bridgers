import { describe, expect, it } from 'vitest';
import type { Task } from '@/types';
import { sortActiveTasks, sortCompletedTasks } from '@/lib/task-sort';

function task(partial: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    priority: 'medium',
    actualDurations: [],
    createdAt: new Date('2026-07-01T12:00:00.000Z'),
    ...partial,
  };
}

describe('sortActiveTasks', () => {
  it('orders by earliest due date first; undated last', () => {
    const sorted = sortActiveTasks([
      task({ id: 'c', title: 'c', dueDate: new Date('2026-07-20') }),
      task({ id: 'a', title: 'a' }),
      task({ id: 'b', title: 'b', dueDate: new Date('2026-07-10') }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('keeps AI plan steps in order under the same due date', () => {
    const due = new Date('2026-07-15');
    const sorted = sortActiveTasks([
      task({ id: '2', title: 'step2', dueDate: due, planId: 'p1', planStepOrder: 2 }),
      task({
        id: 'other',
        title: 'solo',
        dueDate: due,
        priority: 'high',
        createdAt: new Date('2026-06-01'),
      }),
      task({ id: '1', title: 'step1', dueDate: due, planId: 'p1', planStepOrder: 1 }),
      task({ id: '3', title: 'step3', dueDate: due, planId: 'p1', planStepOrder: 3 }),
    ]);
    const planIds = sorted.filter((t) => t.planId === 'p1').map((t) => t.id);
    expect(planIds).toEqual(['1', '2', '3']);
  });

  it('puts earlier-due plans before later-due plans', () => {
    const sorted = sortActiveTasks([
      task({
        id: 'late-1',
        title: 'late',
        dueDate: new Date('2026-08-01'),
        planId: 'late',
        planStepOrder: 1,
      }),
      task({
        id: 'early-2',
        title: 'early2',
        dueDate: new Date('2026-07-05'),
        planId: 'early',
        planStepOrder: 2,
      }),
      task({
        id: 'early-1',
        title: 'early1',
        dueDate: new Date('2026-07-05'),
        planId: 'early',
        planStepOrder: 1,
      }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['early-1', 'early-2', 'late-1']);
  });
});

describe('sortCompletedTasks', () => {
  it('orders by most recently completed first', () => {
    const sorted = sortCompletedTasks([
      task({
        id: 'old',
        title: 'old',
        completedAt: new Date('2026-07-01'),
        dueDate: new Date('2026-07-10'),
      }),
      task({
        id: 'new',
        title: 'new',
        completedAt: new Date('2026-07-12'),
        dueDate: new Date('2026-07-20'),
      }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['new', 'old']);
  });
});
