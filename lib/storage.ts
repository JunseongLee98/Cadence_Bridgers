import { v4 as uuidv4 } from 'uuid';
import {
  Task,
  CalendarEvent,
  WorkHoursConfig,
  WorkSegment,
  InAppNotification,
  UserProfile,
  GoogleIdentity,
} from '@/types';
import type { AppLocale } from '@/lib/i18n/types';
import { LOCALE_STORAGE_KEY, isAppLocale } from '@/lib/i18n/types';
import type { CalibrationByUnit } from '@/lib/estimate-calibration';
import {
  applyRatioToCalibrationMap,
  estimateActualRatio,
} from '@/lib/estimate-calibration';

const TASKS_KEY = 'cadence_tasks';
const EVENTS_KEY = 'cadence_events';
const GOOGLE_TOKENS_KEY = 'cadence_google_tokens';
const GOOGLE_EVENTS_KEY = 'cadence_google_events';
const GOOGLE_SELECTED_CALENDARS_KEY = 'cadence_google_selected_calendars';
const GOOGLE_CALENDAR_COLORS_KEY = 'cadence_google_calendar_colors';
const GOOGLE_IDENTITY_KEY = 'cadence_google_identity';
const APPLE_CONNECTION_TOKEN_KEY = 'cadence_apple_connection_token';
const APPLE_SELECTED_CALENDARS_KEY = 'cadence_apple_selected_calendars';
const APPLE_CALENDAR_COLORS_KEY = 'cadence_apple_calendar_colors';
const APPLE_WRITE_CALENDAR_URL_KEY = 'cadence_apple_write_calendar_url';
const LOCAL_CALIBRATION_KEY = 'cadence_local_calibration';
const ICS_SUBSCRIPTIONS_KEY = 'cadence_ics_subscriptions';
const WORK_HOURS_KEY = 'cadence_work_hours';
const BREAK_AFTER_EVENTS_KEY = 'cadence_break_after_events';
const FOCUS_MINUTES_KEY = 'cadence_focus_minutes';
const SKIP_DURATION_PROMPT_KEY = 'cadence_skip_duration_prompt';
const NOTIFICATIONS_KEY = 'cadence_notifications';
const USER_PROFILE_KEY = 'cadence_user_profile';
const ANONYMOUS_SESSION_KEY = 'cadence_anonymous_session_id';

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
      const raw = JSON.parse(data) as UserProfile & {
        createdAt: string;
        email?: string;
      };
      if (!raw?.username) return null;
      return {
        username: raw.username,
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

  /** Create a default on-device profile when none exists (no login screen). */
  ensureUserProfile(): UserProfile {
    const existing = this.getUserProfile();
    if (existing) return existing;
    const profile: UserProfile = {
      username: 'Guest',
      createdAt: new Date(),
    };
    this.saveUserProfile(profile);
    return profile;
  },

  updateUserProfile(patch: Partial<UserProfile>): UserProfile | null {
    const current = this.getUserProfile();
    if (!current) return null;
    const next: UserProfile = {
      ...current,
      ...patch,
      username: patch.username ?? current.username,
    };
    this.saveUserProfile(next);
    return next;
  },

  clearUserProfile(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(USER_PROFILE_KEY);
  },

  /** Stable anonymous device id for telemetry (not tied to Google or profile). */
  getOrCreateAnonymousSessionId(): string {
    if (typeof window === 'undefined') return '';
    const existing = localStorage.getItem(ANONYMOUS_SESSION_KEY);
    if (existing && existing.trim()) return existing.trim();
    const id = uuidv4();
    localStorage.setItem(ANONYMOUS_SESSION_KEY, id);
    return id;
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
    const merged = { ...existing };
    if (tokens.access_token !== undefined) merged.access_token = tokens.access_token;
    if (tokens.refresh_token !== undefined) merged.refresh_token = tokens.refresh_token;
    if (tokens.calendar_id !== undefined) merged.calendar_id = tokens.calendar_id;
    localStorage.setItem(GOOGLE_TOKENS_KEY, JSON.stringify(merged));
  },

  clearGoogleTokens(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(GOOGLE_TOKENS_KEY);
    localStorage.removeItem(GOOGLE_EVENTS_KEY);
    localStorage.removeItem(GOOGLE_SELECTED_CALENDARS_KEY);
    localStorage.removeItem(GOOGLE_CALENDAR_COLORS_KEY);
    localStorage.removeItem(GOOGLE_IDENTITY_KEY);
  },

  getGoogleIdentity(): GoogleIdentity | null {
    if (typeof window === 'undefined') return null;
    const data = localStorage.getItem(GOOGLE_IDENTITY_KEY);
    if (!data) return null;
    try {
      const raw = JSON.parse(data) as GoogleIdentity;
      if (!raw?.sub || typeof raw.sub !== 'string') return null;
      return {
        sub: raw.sub,
        ...(typeof raw.email === 'string' ? { email: raw.email } : {}),
        ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
      };
    } catch {
      return null;
    }
  },

  saveGoogleIdentity(identity: GoogleIdentity): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(GOOGLE_IDENTITY_KEY, JSON.stringify(identity));
  },

  clearGoogleIdentity(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(GOOGLE_IDENTITY_KEY);
  },

  getLocalCalibration(): CalibrationByUnit {
    if (typeof window === 'undefined') return {};
    const data = localStorage.getItem(LOCAL_CALIBRATION_KEY);
    if (!data) return {};
    try {
      const raw = JSON.parse(data) as CalibrationByUnit;
      if (!raw || typeof raw !== 'object') return {};
      const out: CalibrationByUnit = {};
      for (const [unit, factor] of Object.entries(raw)) {
        if (typeof factor === 'number' && Number.isFinite(factor)) {
          out[unit] = factor;
        }
      }
      return out;
    } catch {
      return {};
    }
  },

  saveLocalCalibration(calibrationByUnit: CalibrationByUnit): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(LOCAL_CALIBRATION_KEY, JSON.stringify(calibrationByUnit));
  },

  /**
   * Update on-device calibration when actual vs estimate gap is large.
   * Returns the updated map (whether or not a change occurred).
   */
  recordLocalCalibrationFromCompletion(input: {
    actualMinutes: number;
    estimatedMinutes: number;
    workUnit?: string;
  }): CalibrationByUnit {
    const ratio = estimateActualRatio(input.actualMinutes, input.estimatedMinutes);
    const current = this.getLocalCalibration();
    if (ratio === undefined) return current;
    const { next, updated } = applyRatioToCalibrationMap(
      current,
      input.workUnit,
      ratio
    );
    if (updated) this.saveLocalCalibration(next);
    return updated ? next : current;
  },

  /** Calendar IDs to read into Cadence (read-only). Empty = show none. */
  getGoogleSelectedCalendarIds(): string[] {
    if (typeof window === 'undefined') return ['primary'];
    const data = localStorage.getItem(GOOGLE_SELECTED_CALENDARS_KEY);
    if (!data) return ['primary'];
    try {
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return ['primary'];
      return Array.from(
        new Set(
          parsed
            .filter((id): id is string => typeof id === 'string')
            .map((id) => id.trim())
            .filter(Boolean)
        )
      );
    } catch {
      return ['primary'];
    }
  },

  saveGoogleSelectedCalendarIds(ids: string[]): void {
    if (typeof window === 'undefined') return;
    const cleaned = Array.from(
      new Set(
        ids
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter(Boolean)
      )
    );
    localStorage.setItem(GOOGLE_SELECTED_CALENDARS_KEY, JSON.stringify(cleaned));
  },

  getGoogleCalendarColors(): Record<string, string> {
    if (typeof window === 'undefined') return {};
    const data = localStorage.getItem(GOOGLE_CALENDAR_COLORS_KEY);
    if (!data) return {};
    try {
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, string> = {};
      for (const [id, color] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof color === 'string' && color.trim()) out[id] = color.trim();
      }
      return out;
    } catch {
      return {};
    }
  },

  saveGoogleCalendarColors(colors: Record<string, string>): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(GOOGLE_CALENDAR_COLORS_KEY, JSON.stringify(colors));
  },

  setGoogleCalendarColor(calendarId: string, color: string): Record<string, string> {
    const next = { ...this.getGoogleCalendarColors(), [calendarId]: color };
    this.saveGoogleCalendarColors(next);
    return next;
  },

  // Apple / iCloud CalDAV (connection token only — never store app-specific password)
  getAppleConnectionToken(): string | null {
    if (typeof window === 'undefined') return null;
    const token = localStorage.getItem(APPLE_CONNECTION_TOKEN_KEY);
    return token && token.trim() ? token.trim() : null;
  },

  saveAppleConnectionToken(token: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(APPLE_CONNECTION_TOKEN_KEY, token.trim());
  },

  getAppleWriteCalendarUrl(): string | null {
    if (typeof window === 'undefined') return null;
    const url = localStorage.getItem(APPLE_WRITE_CALENDAR_URL_KEY);
    return url && url.trim() ? url.trim() : null;
  },

  saveAppleWriteCalendarUrl(url: string): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(APPLE_WRITE_CALENDAR_URL_KEY, url.trim());
  },

  clearAppleConnection(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(APPLE_CONNECTION_TOKEN_KEY);
    localStorage.removeItem(APPLE_SELECTED_CALENDARS_KEY);
    localStorage.removeItem(APPLE_CALENDAR_COLORS_KEY);
    localStorage.removeItem(APPLE_WRITE_CALENDAR_URL_KEY);
  },

  getAppleSelectedCalendarUrls(): string[] {
    if (typeof window === 'undefined') return [];
    const data = localStorage.getItem(APPLE_SELECTED_CALENDARS_KEY);
    if (!data) return [];
    try {
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return [];
      return Array.from(
        new Set(
          parsed
            .filter((id): id is string => typeof id === 'string')
            .map((id) => id.trim())
            .filter(Boolean)
        )
      );
    } catch {
      return [];
    }
  },

  saveAppleSelectedCalendarUrls(urls: string[]): void {
    if (typeof window === 'undefined') return;
    const cleaned = Array.from(
      new Set(
        urls
          .filter((id): id is string => typeof id === 'string')
          .map((id) => id.trim())
          .filter(Boolean)
      )
    );
    localStorage.setItem(APPLE_SELECTED_CALENDARS_KEY, JSON.stringify(cleaned));
  },

  getAppleCalendarColors(): Record<string, string> {
    if (typeof window === 'undefined') return {};
    const data = localStorage.getItem(APPLE_CALENDAR_COLORS_KEY);
    if (!data) return {};
    try {
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, string> = {};
      for (const [id, color] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof color === 'string' && color.trim()) out[id] = color.trim();
      }
      return out;
    } catch {
      return {};
    }
  },

  saveAppleCalendarColors(colors: Record<string, string>): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(APPLE_CALENDAR_COLORS_KEY, JSON.stringify(colors));
  },

  setAppleCalendarColor(calendarUrl: string, color: string): Record<string, string> {
    const next = { ...this.getAppleCalendarColors(), [calendarUrl]: color };
    this.saveAppleCalendarColors(next);
    return next;
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

  /** When true, skip the "how long did it take?" prompt and use scheduled/estimate duration. */
  getSkipDurationPrompt(): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SKIP_DURATION_PROMPT_KEY) === '1';
  },

  saveSkipDurationPrompt(skip: boolean): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(SKIP_DURATION_PROMPT_KEY, skip ? '1' : '0');
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

