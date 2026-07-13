import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storage } from '@/lib/storage';
import type { InAppNotification } from '@/types';

describe('storage (browser API mocked)', () => {
  const lsStore: Record<string, string> = {};

  beforeEach(() => {
    Object.keys(lsStore).forEach((k) => delete lsStore[k]);
    const ls = {
      getItem: (k: string) => (Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null),
      setItem: (k: string, v: string) => {
        lsStore[k] = String(v);
      },
      removeItem: (k: string) => {
        delete lsStore[k];
      },
      clear: () => {
        Object.keys(lsStore).forEach((k) => delete lsStore[k]);
      },
      key: () => null,
      get length() {
        return Object.keys(lsStore).length;
      },
    };
    vi.stubGlobal('localStorage', ls as unknown as Storage);
    vi.stubGlobal('window', { localStorage: ls } as unknown as Window);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips tasks', () => {
    const tasks = [
      {
        id: 't1',
        title: 'Hello',
        actualDurations: [] as number[],
        priority: 'medium' as const,
        createdAt: new Date('2026-02-01T12:00:00.000Z'),
        estimatedDuration: 90,
        dueDate: new Date(2026, 3, 20, 0, 0, 0, 0),
      },
    ];
    storage.saveTasks(tasks);
    const loaded = storage.getTasks();
    expect(loaded.length).toBe(1);
    expect(loaded[0].title).toBe('Hello');
    expect(loaded[0].estimatedDuration).toBe(90);
    expect(loaded[0].dueDate?.getFullYear()).toBe(2026);
  });

  it('returns default work hours when unset', () => {
    expect(storage.getWorkHours().segments).toEqual([{ startHour: 9, endHour: 18 }]);
  });

  it('round-trips work hours segments', () => {
    storage.saveWorkHours({
      segments: [
        { startHour: 6, endHour: 9 },
        { startHour: 18, endHour: 21 },
      ],
    });
    const wh = storage.getWorkHours();
    expect(wh.segments).toHaveLength(2);
    expect(wh.segments[0].startHour).toBe(6);
  });

  it('clamps focus minutes to 30–180', () => {
    storage.saveFocusMinutes(5);
    expect(storage.getFocusMinutes()).toBe(30);
    storage.saveFocusMinutes(500);
    expect(storage.getFocusMinutes()).toBe(180);
    storage.saveFocusMinutes(90);
    expect(storage.getFocusMinutes()).toBe(90);
  });

  it('defaults break after events to 5 when key missing', () => {
    expect(storage.getBreakAfterEvents()).toBe(5);
    storage.saveBreakAfterEvents(15);
    expect(storage.getBreakAfterEvents()).toBe(15);
  });

  it('round-trips notifications and marks read', () => {
    const notifs: InAppNotification[] = [
      {
        id: 'n1',
        kind: 'cadence_subtask_scheduled',
        title: 'Scheduled: Essay outline',
        body: 'Mon 10:00–10:50',
        createdAt: new Date('2026-02-01T12:00:00.000Z'),
        eventId: 'scheduled-t1-1',
        taskId: 't1',
      },
    ];
    storage.saveNotifications(notifs);
    const loaded = storage.getNotifications();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].title).toBe('Scheduled: Essay outline');
    expect(loaded[0].createdAt instanceof Date).toBe(true);

    const updated = storage.markNotificationRead('n1');
    expect(updated[0].readAt instanceof Date).toBe(true);
  });

  it('round-trips user profile', () => {
    storage.saveUserProfile({
      username: 'Alex',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const loaded = storage.getUserProfile();
    expect(loaded?.username).toBe('Alex');
    const updated = storage.updateUserProfile({ username: 'Alexa' });
    expect(updated?.username).toBe('Alexa');
  });
});
