import { v4 as uuidv4 } from 'uuid';
import {
  Task,
  CalendarEvent,
  WorkHoursConfig,
  WorkSegment,
  InAppNotification,
  UserProfile,
} from '@/types';
import type { AppLocale } from '@/lib/i18n/types';
import { LOCALE_STORAGE_KEY, isAppLocale } from '@/lib/i18n/types';

const TASKS_KEY = 'cadence_tasks';
const EVENTS_KEY = 'cadence_events';
const GOOGLE_TOKENS_KEY = 'cadence_google_tokens';
const GOOGLE_EVENTS_KEY = 'cadence_google_events';
const ICS_SUBSCRIPTIONS_KEY = 'cadence_ics_subscriptions';
const WORK_HOURS_KEY = 'cadence_work_hours';
const BREAK_AFTER_EVENTS_KEY = 'cadence_break_after_events';
const FOCUS_MINUTES_KEY = 'cadence_focus_minutes';
const NOTIFICATIONS_KEY = 'cadence_notifications';
const USER_PROFILE_KEY = 'cadence_user_profile';

// Default pastel color palette for subscribed ICS calendars (easy on the eyes)
const ICS_SUBSCRIPTION_COLORS = [
  '#bfdbfe', // pastel blue
  '#bbf7d0', // pastel green
  '#fed7aa', // pastel orange
  '#fecaca', // pastel red
  '#e9d5ff', // pastel purple
  '#fbcfe8', // pastel pink
];

export const storage = {
  // Tasks
  getTasks(): Task[] {
    if (typeof window === 'undefined') return [];
    
    const data = localStorage.getItem(TASKS_KEY);
    if (!data) return [];
    
    const tasks = JSON.parse(data);
    return tasks.map((task: any) => ({
      ...task,
      createdAt: new Date(task.createdAt),
      completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
      dueDate: task.dueDate ? new Date(task.dueDate) : undefined,
    }));
  },

  saveTasks(tasks: Task[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
  },

  // Events
  getEvents(): CalendarEvent[] {
    if (typeof window === 'undefined') return [];
    
    const data = localStorage.getItem(EVENTS_KEY);
    if (!data) return [];
    
    const events = JSON.parse(data);
    return events.map((event: any) => ({
      ...event,
      start: new Date(event.start),
      end: new Date(event.end),
    }));
  },

  saveEvents(events: CalendarEvent[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
  },

  // Notifications (in-app)
  getNotifications(): InAppNotification[] {
    if (typeof window === 'undefined') return [];
    const data = localStorage.getItem(NOTIFICATIONS_KEY);
    if (!data) return [];

    const notifs = JSON.parse(data) as any[];
    if (!Array.isArray(notifs)) return [];
    return notifs
      .map((n: any): InAppNotification => ({
        ...n,
        createdAt: new Date(n.createdAt),
        readAt: n.readAt ? new Date(n.readAt) : undefined,
      }))
      .filter((n: InAppNotification) => Boolean(n.id) && Boolean(n.kind) && Boolean(n.createdAt));
  },

  saveNotifications(notifications: InAppNotification[]): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
  },

  addNotifications(next: InAppNotification[]): InAppNotification[] {
    const existing = this.getNotifications();
    const seen = new Set(existing.map((n) => n.id));
    const merged = [...existing];
    for (const n of next) {
      if (!n?.id) continue;
      if (seen.has(n.id)) continue;
      merged.push(n);
      seen.add(n.id);
    }
    // Newest first for UI
    merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    this.saveNotifications(merged);
    return merged;
  },

  markNotificationRead(id: string): InAppNotification[] {
    const existing = this.getNotifications();
    const now = new Date();
    const updated = existing.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? now } : n));
    this.saveNotifications(updated);
    return updated;
  },

  markAllNotificationsRead(): InAppNotification[] {
    const existing = this.getNotifications();
    const now = new Date();
    const updated = existing.map((n) => ({ ...n, readAt: n.readAt ?? now }));
    this.saveNotifications(updated);
    return updated;
  },

  clearNotifications(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(NOTIFICATIONS_KEY);
  },

  getUserProfile(): UserProfile | null {
    if (typeof window === 'undefined') return null;
    const data = localStorage.getItem(USER_PROFILE_KEY);
    if (!data) return null;
    try {
      const raw = JSON.parse(data) as UserProfile & { createdAt: string };
      if (!raw?.username || !raw?.email) return null;
      return {
        username: raw.username,
        email: raw.email,
        emailVerified: raw.emailVerified === undefined ? undefined : Boolean(raw.emailVerified),
        emailNotificationsEnabled:
          raw.emailNotificationsEnabled === undefined
            ? undefined
            : raw.emailNotificationsEnabled !== false,
        calendarFeedToken:
          typeof raw.calendarFeedToken === 'string' ? raw.calendarFeedToken : undefined,
        createdAt: new Date(raw.createdAt),
      };
    } catch {
      return null;
    }
  },

  saveUserProfile(profile: UserProfile): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
  },

  updateUserProfile(patch: Partial<UserProfile>): UserProfile | null {
    const current = this.getUserProfile();
    if (!current) return null;
    const next: UserProfile = {
      ...current,
      ...patch,
      username: patch.username ?? current.username,
      email: patch.email ?? current.email,
    };
    this.saveUserProfile(next);
    return next;
  },

  clearUserProfile(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(USER_PROFILE_KEY);
  },

  ensureCalendarFeedToken(): string | null {
    const profile = this.getUserProfile();
    if (!profile) return null;
    if (profile.calendarFeedToken) return profile.calendarFeedToken;
    const token = uuidv4();
    this.updateUserProfile({ calendarFeedToken: token });
    return token;
  },

  regenerateCalendarFeedToken(): string | null {
    const profile = this.getUserProfile();
    if (!profile) return null;
    const token = uuidv4();
    this.updateUserProfile({ calendarFeedToken: token });
    return token;
  },

  // Google Calendar Tokens
  getGoogleTokens(): {
    access_token?: string;
    refresh_token?: string;
    calendar_id?: string;
  } | null {
    if (typeof window === 'undefined') return null;
    const data = localStorage.getItem(GOOGLE_TOKENS_KEY);
    return data ? JSON.parse(data) : null;
  },

  saveGoogleTokens(tokens: {
    access_token?: string;
    refresh_token?: string;
    calendar_id?: string;
  }): void {
    if (typeof window === 'undefined') return;
    const existing = this.getGoogleTokens() ?? {};
    localStorage.setItem(
      GOOGLE_TOKENS_KEY,
      JSON.stringify({ ...existing, ...tokens })
    );
  },

  clearGoogleTokens(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(GOOGLE_TOKENS_KEY);
    localStorage.removeItem(GOOGLE_EVENTS_KEY);
  },

  // ICS Calendar Subscriptions
  getICSSubscriptions(): Array<{ id: string; url: string; name: string; color?: string }> {
    if (typeof window === 'undefined') return [];
    const data = localStorage.getItem(ICS_SUBSCRIPTIONS_KEY);
    const parsed: Array<{ id: string; url: string; name: string; color?: string }> = data ? JSON.parse(data) : [];
    return parsed;
  },

  saveICSSubscriptions(subscriptions: Array<{ id: string; url: string; name: string; color?: string }>): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ICS_SUBSCRIPTIONS_KEY, JSON.stringify(subscriptions));
  },

  addICSSubscription(url: string, name: string, color?: string): void {
    const subscriptions = this.getICSSubscriptions();
    const assignedColor =
      color ||
      ICS_SUBSCRIPTION_COLORS[subscriptions.length % ICS_SUBSCRIPTION_COLORS.length];

    const newSubscription = {
      id: `ics-sub-${Date.now()}-${Math.random()}`,
      url,
      name: name || new URL(url).hostname,
      color: assignedColor,
    };
    this.saveICSSubscriptions([...subscriptions, newSubscription]);
  },

  removeICSSubscription(id: string): void {
    const subscriptions = this.getICSSubscriptions();
    this.saveICSSubscriptions(subscriptions.filter(sub => sub.id !== id));
  },

  // Work Hours (supports multiple segments per day, default single 9AM–6PM segment)
  getWorkHours(): WorkHoursConfig {
    const defaultConfig: WorkHoursConfig = {
      segments: [{ startHour: 9, endHour: 18 }],
    };

    if (typeof window === 'undefined') return defaultConfig;

    const data = localStorage.getItem(WORK_HOURS_KEY);
    if (!data) return defaultConfig;

    try {
      const parsed = JSON.parse(data);

      // New shape: { segments: [...] }
      if (Array.isArray(parsed?.segments)) {
        const segments: WorkSegment[] = parsed.segments
          .map((seg: any) => ({
            startHour: typeof seg.startHour === 'number' ? seg.startHour : 9,
            endHour: typeof seg.endHour === 'number' ? seg.endHour : 18,
          }))
          .filter((seg: WorkSegment) => seg.startHour < seg.endHour);

        return segments.length > 0 ? { segments } : defaultConfig;
      }

      // Legacy shape: array of segments directly
      if (Array.isArray(parsed)) {
        const segments: WorkSegment[] = parsed
          .map((seg: any) => ({
            startHour: typeof seg.startHour === 'number' ? seg.startHour : 9,
            endHour: typeof seg.endHour === 'number' ? seg.endHour : 18,
          }))
          .filter((seg: WorkSegment) => seg.startHour < seg.endHour);

        return segments.length > 0 ? { segments } : defaultConfig;
      }

      // Legacy shape: single { startHour, endHour }
      if (typeof parsed.startHour === 'number' && typeof parsed.endHour === 'number') {
        if (parsed.startHour < parsed.endHour) {
          return {
            segments: [
              {
                startHour: parsed.startHour,
                endHour: parsed.endHour,
              },
            ],
          };
        }
      }
    } catch {
      // Fall back to default on parse errors
    }

    return defaultConfig;
  },

  saveWorkHours(workHours: WorkHoursConfig): void {
    if (typeof window === 'undefined') return;

    const segments: WorkSegment[] = (workHours?.segments || [])
      .map((seg) => ({
        // Clamp to valid 24h clock range
        startHour: Math.max(0, Math.min(23, seg.startHour)),
        endHour: Math.max(0, Math.min(23, seg.endHour)),
      }))
      .filter((seg) => seg.startHour < seg.endHour);

    const configToSave: WorkHoursConfig =
      segments.length > 0
        ? { segments }
        : { segments: [{ startHour: 9, endHour: 18 }] };

    localStorage.setItem(WORK_HOURS_KEY, JSON.stringify(configToSave));
  },

  // Break after events (minutes) - gap before next task can be scheduled
  getBreakAfterEvents(): number {
    if (typeof window === 'undefined') return 5;
    const data = localStorage.getItem(BREAK_AFTER_EVENTS_KEY);
    return data !== null ? parseInt(data, 10) : 5;
  },

  saveBreakAfterEvents(minutes: number): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(BREAK_AFTER_EVENTS_KEY, String(minutes));
  },

  // Focus minutes (30–180) - max comfortable task chunk, default 50
  getFocusMinutes(): number {
    if (typeof window === 'undefined') return 50;
    const data = localStorage.getItem(FOCUS_MINUTES_KEY);
    const val = data !== null ? parseInt(data, 10) : 50;
    return Math.max(30, Math.min(180, val));
  },

  saveFocusMinutes(minutes: number): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(FOCUS_MINUTES_KEY, String(Math.max(30, Math.min(180, minutes))));
  },

  getLocale(): AppLocale | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (!raw) return null;
    return isAppLocale(raw) ? raw : null;
  },

  saveLocale(locale: AppLocale): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  },
};

