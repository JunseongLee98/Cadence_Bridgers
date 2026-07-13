'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Task, CalendarEvent, InAppNotification, UserProfile } from '@/types';
import { storage } from '@/lib/storage';
import { syncCalendarFeedToServer } from '@/lib/sync-calendar-feed';
import {
  buildCalendarFeedUrl,
  buildWebcalFeedUrl,
  buildOutlookCalendarSubscribeUrl,
  getCalendarFeedSubscriptionOrigin,
  isLocalhostFeedOrigin,
  probePublicCalendarFeedHealth,
  calendarFeedSyncDiffersFromSubscription,
} from '@/lib/calendar-feed-url';
import { filterEventsForCalendarFeed, serializeFeedEvents } from '@/lib/calendar-feed-events';
import { CalendarAIAgent } from '@/lib/ai-agent';
import { SCHEDULE_MAX_HORIZON_DAYS } from '@/lib/schedule-constants';
import { formatDateToLocalISO, parseLocalDateInput } from '@/lib/date-utils';
import Calendar from '@/components/Calendar';
import NotificationsBell from '@/components/NotificationsBell';
import { v4 as uuidv4 } from 'uuid';
import Image from 'next/image';
import Link from 'next/link';
import { Plus, X, Clock, CheckCircle2, ChevronDown, ChevronRight, ChevronLeft, Menu, Calendar as CalendarIcon, LucideCalendarPlus, List, Upload, Link2, Trash2, CheckSquare, Settings, Sparkles } from 'lucide-react';
import { View } from 'react-big-calendar';
import { parseICSFileFromFile, parseICSFileFromFileAsTasks, fetchICSFromURL } from '@/lib/ics-parser';
import { formatMinutesToHoursMinutes } from '@/lib/time-utils';
import { useI18n } from '@/lib/i18n/context';
import type { AppLocale } from '@/lib/i18n/types';
import {
  calibrateSubtaskEstimates,
  type CalibrationByUnit,
} from '@/lib/estimate-calibration';
import {
  fetchLearningProfile,
  postLearningCalibration,
} from '@/lib/learning-client';
import { htmlToReadableText } from '@/lib/html-readable';
import ReadableDescription from '@/components/ReadableDescription';

function dedupeCalendarEventsById(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

function googleTokensIndicateConnection(
  tokens: { access_token?: string; refresh_token?: string } | null
): boolean {
  return Boolean(tokens?.access_token || tokens?.refresh_token);
}

export default function Home() {
  const router = useRouter();
  const { m, locale, setLocale, dateLocale, t } = useI18n();
  const [authReady, setAuthReady] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [calendarFeedUrl, setCalendarFeedUrl] = useState<string | null>(null);
  const [feedSyncError, setFeedSyncError] = useState<string | null>(null);
  const [feedLinkCopied, setFeedLinkCopied] = useState(false);
  const [feedSyncedEventCount, setFeedSyncedEventCount] = useState<number | null>(null);
  const [feedSyncing, setFeedSyncing] = useState(false);
  const [googleSyncing, setGoogleSyncing] = useState(false);
  const [googlePushError, setGooglePushError] = useState<string | null>(null);
  const [googlePushedCount, setGooglePushedCount] = useState<number | null>(null);
  const [publicFeedDeployed, setPublicFeedDeployed] = useState<boolean | null>(null);
  const initialAppDataLoadedRef = useRef(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [tasksDropdownOpen, setTasksDropdownOpen] = useState(false);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [autoScheduleNewTask, setAutoScheduleNewTask] = useState(true);
  const [taskSidebarTab, setTaskSidebarTab] = useState<'active' | 'completed'>('active');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    estimatedDuration: 60,
    priority: 'medium' as 'low' | 'medium' | 'high',
    category: '',
    dueDate: undefined as string | undefined, // ISO string format for date input
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [stats, setStats] = useState<any[]>([]);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([]);
  const [isLoadingGoogleEvents, setIsLoadingGoogleEvents] = useState(false);
  const [showGoogleCalendarsDialog, setShowGoogleCalendarsDialog] = useState(false);
  const [googleCalendarList, setGoogleCalendarList] = useState<
    Array<{
      id: string;
      summary: string;
      primary?: boolean;
      backgroundColor?: string;
    }>
  >([]);
  const [selectedGoogleCalendarIds, setSelectedGoogleCalendarIds] = useState<string[]>(['primary']);
  const [googleCalendarColors, setGoogleCalendarColors] = useState<Record<string, string>>({});
  const [isLoadingGoogleCalendars, setIsLoadingGoogleCalendars] = useState(false);
  const [isImportingICS, setIsImportingICS] = useState(false);
  const [icsSubscribedEvents, setICSSubscribedEvents] = useState<CalendarEvent[]>([]);
  const [icsSubscriptions, setICSSubscriptions] = useState<
    Array<{ id: string; url: string; name: string; color?: string }>
  >([]);
  const [isLoadingICSSubscription, setIsLoadingICSSubscription] = useState(false);
  const [newSubscriptionUrl, setNewSubscriptionUrl] = useState('');
  const [newSubscriptionName, setNewSubscriptionName] = useState('');
  const [showSubscriptionDialog, setShowSubscriptionDialog] = useState(false);
  const [openColorMenuId, setOpenColorMenuId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showEventDialog, setShowEventDialog] = useState(false);
  const [isDecomposingEvent, setIsDecomposingEvent] = useState(false);
  const [isDecomposingNewTask, setIsDecomposingNewTask] = useState(false);
  const [breakDownNewTaskWithAi, setBreakDownNewTaskWithAi] = useState(true);
  const [conversionDuration, setConversionDuration] = useState(60); // Default duration in minutes
  const [workHours, setWorkHours] = useState<{ segments: { startHour: number; endHour: number }[] }>({
    segments: [{ startHour: 9, endHour: 18 }],
  });
  const [showWorkHoursDialog, setShowWorkHoursDialog] = useState(false);
  const [showAddTaskDialog, setShowAddTaskDialog] = useState(false);
  const [tempWorkHours, setTempWorkHours] = useState<{ segments: { startHour: number; endHour: number }[] }>({
    segments: [{ startHour: 9, endHour: 18 }],
  });
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [breakAfterEvents, setBreakAfterEvents] = useState(5);
  const [tempBreakAfterEvents, setTempBreakAfterEvents] = useState(5);
  const [focusMinutes, setFocusMinutes] = useState(50);
  const [tempFocusMinutes, setTempFocusMinutes] = useState(50);
  const [skipDurationPrompt, setSkipDurationPrompt] = useState(false);
  const [tempSkipDurationPrompt, setTempSkipDurationPrompt] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [completionDurationInput, setCompletionDurationInput] = useState('');
  const [completionDontAskAgain, setCompletionDontAskAgain] = useState(false);
  const [showDueDatePicker, setShowDueDatePicker] = useState(false);
  const [taskDurationMode, setTaskDurationMode] = useState<'preset' | 'custom'>('preset');
  const [taskDurationCustomHours, setTaskDurationCustomHours] = useState(1);
  const [conversionDurationMode, setConversionDurationMode] = useState<'preset' | 'custom'>('preset');
  const [conversionDurationCustomHours, setConversionDurationCustomHours] = useState(1);
  const [miniCalendarDate, setMiniCalendarDate] = useState(new Date());
  const [mainCalendarDate, setMainCalendarDate] = useState(new Date());
  const [calendarView, setCalendarView] = useState<View>('week');

  const tasksDropdownRef = useRef<HTMLDivElement>(null);
  const subscriptionColorMenuRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tasksFileInputRef = useRef<HTMLInputElement>(null);
  
  // Use refs to track latest state for scheduling
  const googleEventsRef = useRef<CalendarEvent[]>([]);
  const icsSubscribedEventsRef = useRef<CalendarEvent[]>([]);
  const userProfileRef = useRef<UserProfile | null>(null);
  
  // Keep refs in sync with state
  useEffect(() => {
    googleEventsRef.current = googleEvents;
  }, [googleEvents]);
  
  useEffect(() => {
    icsSubscribedEventsRef.current = icsSubscribedEvents;
  }, [icsSubscribedEvents]);

  useEffect(() => {
    userProfileRef.current = userProfile;
  }, [userProfile]);

  // Color palette for subscribed ICS calendars
  const ICS_SUBSCRIPTION_COLORS = [
    '#dbeafe', '#bfdbfe', '#eff6ff', // blues
    '#dcfce7', '#bbf7d0', '#f0fdf4', // greens
    '#ffedd5', '#fed7aa', '#fff7ed', // oranges
    '#fee2e2', '#fecaca', '#fef2f2', // reds
    '#f3e8ff', '#e9d5ff', '#faf5ff', // purples
    '#fce7f3', '#fbcfe8', '#fdf2f8', // pinks
    '#e0e7ff', '#c7d2fe', '#eef2ff', // indigo
    '#fef3c7', '#fef9c3', '#fefce8', // yellows
  ];

  // Load data from localStorage on mount
  useEffect(() => {
    const savedTasks = storage.getTasks();
    const savedEvents = storage.getEvents();
    setTasks(savedTasks);
    setEvents(savedEvents);
    setNotifications(storage.getNotifications());

    // Load work hours
    const savedWorkHours = storage.getWorkHours();
    setWorkHours(savedWorkHours);
    setTempWorkHours(savedWorkHours);

    // Load scheduling settings
    setBreakAfterEvents(storage.getBreakAfterEvents());
    setTempBreakAfterEvents(storage.getBreakAfterEvents());
    setFocusMinutes(storage.getFocusMinutes());
    setTempFocusMinutes(storage.getFocusMinutes());
    const skipDuration = storage.getSkipDurationPrompt();
    setSkipDurationPrompt(skipDuration);
    setTempSkipDurationPrompt(skipDuration);

    // Check for Google Calendar connection
    const tokens = storage.getGoogleTokens();
    setSelectedGoogleCalendarIds(storage.getGoogleSelectedCalendarIds());
    setGoogleCalendarColors(storage.getGoogleCalendarColors());
    if (googleTokensIndicateConnection(tokens)) {
      setGoogleConnected(true);
      if (tokens?.access_token) {
        fetchGoogleCalendarEvents();
      }
    }

    // Handle OAuth callback from URL query params
    const urlParams = new URLSearchParams(window.location.search);
    const oauthError = urlParams.get('error');
    let shouldPushGoogleAfterOAuth = false;

    if (oauthError) {
      const msg =
        oauthError === 'access_denied'
          ? m.feed.googleOAuthDenied
          : oauthError === 'auth_failed'
            ? m.feed.googleOAuthFailed
            : m.feed.googleOAuthFailed;
      setGooglePushError(msg);
      window.history.replaceState({}, '', window.location.pathname);
    }

    const accessToken = urlParams.get('access_token');
    const refreshToken = urlParams.get('refresh_token');

    if (accessToken) {
      const patch: { access_token: string; refresh_token?: string } = {
        access_token: accessToken,
      };
      if (refreshToken) patch.refresh_token = refreshToken;
      storage.saveGoogleTokens(patch);
      setGoogleConnected(true);
      window.history.replaceState({}, '', window.location.pathname);
      fetchGoogleCalendarEvents();
      shouldPushGoogleAfterOAuth = true;
    }

    const googleSub = urlParams.get('google_sub');
    const googleEmail = urlParams.get('google_email');
    const googleName = urlParams.get('google_name');
    if (googleSub) {
      storage.saveGoogleIdentity({
        sub: googleSub,
        ...(googleEmail ? { email: googleEmail } : {}),
        ...(googleName ? { name: googleName } : {}),
      });
      if (googleName || googleEmail) {
        storage.updateUserProfile({
          username: googleName || googleEmail || 'Guest',
        });
      }
      window.history.replaceState({}, '', window.location.pathname);
    }

    // Load ICS subscriptions
    const rawSubscriptions = storage.getICSSubscriptions();
    // Ensure each subscription has a color assigned
    const subscriptionsWithColors = rawSubscriptions.map((sub, index) => ({
      ...sub,
      color:
        sub.color ||
        ICS_SUBSCRIPTION_COLORS[index % ICS_SUBSCRIPTION_COLORS.length],
    }));
    setICSSubscriptions(subscriptionsWithColors);
    if (subscriptionsWithColors.length > 0) {
      // Persist colors for any existing subscriptions that didn't have one
      storage.saveICSSubscriptions(subscriptionsWithColors);
      fetchAllICSSubscriptions(subscriptionsWithColors);
    }

    // First-time tutorial
    try {
      const completed = window.localStorage.getItem('cadence:tutorialCompleted');
      if (!completed) {
        setTutorialStep(0);
        setShowTutorial(true);
      }
    } catch {
      // ignore storage access errors
    }

    const profile = storage.ensureUserProfile();
    setUserProfile(profile);

    setAuthReady(true);
    initialAppDataLoadedRef.current = true;

    if (shouldPushGoogleAfterOAuth) {
      void pushGoogleCalendar(storage.getEvents(), false);
    }
  }, [router]);

  const startTutorial = () => {
    try {
      window.localStorage.removeItem('cadence:tutorialCompleted');
    } catch {
      // ignore
    }
    setTutorialStep(0);
    setShowTutorial(true);
  };

  const completeTutorial = () => {
    try {
      window.localStorage.setItem('cadence:tutorialCompleted', '1');
    } catch {
      // ignore
    }
    setShowTutorial(false);
  };

  // Load user's saved theme preference
  useEffect(() => {
    const savedTheme = localStorage.getItem('cadence-theme');
    setDarkMode(savedTheme === 'dark');
  }, []);

  // Apply theme changes
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('cadence-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // Auto-refresh ICS subscriptions more often so they feel live
  useEffect(() => {
    if (icsSubscriptions.length === 0) return;

    const refresh = () => fetchAllICSSubscriptions(icsSubscriptions);
    const intervalMs = 5 * 60 * 1000; // 5 minutes
    const interval = setInterval(refresh, intervalMs);

    // Also refresh when user returns to the tab so calendar is up to date
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [icsSubscriptions]);

  // Fetch Google Calendar events
  const refreshGoogleAccessTokenClient = async (): Promise<string | null> => {
    const tokens = storage.getGoogleTokens();
    if (!tokens?.refresh_token) return null;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refresh_token }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (typeof data.accessToken !== 'string') return null;
      storage.saveGoogleTokens({ access_token: data.accessToken });
      return data.accessToken;
    } catch {
      return null;
    }
  };

  const getGoogleAccessTokenForLearning = async (): Promise<string | null> => {
    const tokens = storage.getGoogleTokens();
    if (!googleTokensIndicateConnection(tokens)) return null;
    let accessToken = tokens?.access_token ?? null;
    if (!accessToken) {
      accessToken = await refreshGoogleAccessTokenClient();
    }
    return accessToken;
  };

  /** Sync per-user calibration from Google learning profile when signed in. */
  const syncLearningProfile = async () => {
    try {
      const accessToken = await getGoogleAccessTokenForLearning();
      if (!accessToken) return;
      const profile = await fetchLearningProfile(accessToken);
      if (profile?.googleSub) {
        storage.saveGoogleIdentity({
          sub: profile.googleSub,
          ...(profile.email ? { email: profile.email } : {}),
          ...(profile.displayName ? { name: profile.displayName } : {}),
        });
      }
    } catch (err) {
      console.warn('learning profile sync failed', err);
    }
  };

  useEffect(() => {
    if (!googleConnected) return;
    void syncLearningProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when connection flips on
  }, [googleConnected]);

  const fetchGoogleCalendarEvents = async () => {
    const tokens = storage.getGoogleTokens();
    if (!googleTokensIndicateConnection(tokens)) return;

    setIsLoadingGoogleEvents(true);
    try {
      let accessToken = tokens?.access_token;
      if (!accessToken) {
        accessToken = (await refreshGoogleAccessTokenClient()) ?? undefined;
      }
      if (!accessToken) {
        setGooglePushError(m.feed.googleReconnect);
        return;
      }

      const now = new Date();
      const timeMin = now.toISOString();
      const timeMax = new Date(
        now.getTime() + SCHEDULE_MAX_HORIZON_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      const selectedIds = storage.getGoogleSelectedCalendarIds();
      setSelectedGoogleCalendarIds(selectedIds);
      const colors = storage.getGoogleCalendarColors();
      setGoogleCalendarColors(colors);
      const calendarIdsParam = encodeURIComponent(selectedIds.join(','));
      const calendarColorsParam = encodeURIComponent(JSON.stringify(colors));

      const fetchEvents = (token: string) =>
        fetch(
          `/api/calendar/events?access_token=${encodeURIComponent(token)}&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&calendarIds=${calendarIdsParam}&calendarColors=${calendarColorsParam}`
        );

      let response = await fetchEvents(accessToken);
      if (response.status === 401) {
        const refreshed = await refreshGoogleAccessTokenClient();
        if (refreshed) {
          accessToken = refreshed;
          response = await fetchEvents(refreshed);
        }
      }

      if (response.ok) {
        const data = await response.json();
        const fetchedEvents = data.events.map((event: CalendarEvent) => ({
          ...event,
          start: new Date(event.start),
          end: new Date(event.end),
        }));
        setGoogleEvents(fetchedEvents);
        setGooglePushError(null);
      } else {
        console.error('Failed to fetch Google Calendar events');
        if (response.status === 401) {
          handleDisconnectGoogle();
          setGooglePushError(m.feed.googleReconnect);
        }
      }
    } catch (error) {
      console.error('Error fetching Google Calendar events:', error);
    } finally {
      setIsLoadingGoogleEvents(false);
    }
  };

  // Connect to Google Calendar
  const handleConnectGoogle = async () => {
    try {
      const response = await fetch('/api/auth');
      
      if (!response.ok) {
        const errorText = await response.text();
        try {
          const errorData = JSON.parse(errorText);
          alert(`Failed to connect: ${errorData.error || 'Unknown error'}. Make sure you have set up GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env.local file.`);
        } catch {
          alert(`Failed to connect: ${response.status} ${response.statusText}. Make sure your API routes are working and environment variables are set.`);
        }
        return;
      }
      
      const data = await response.json();
      
      if (data.error) {
        alert(`Failed to connect: ${data.error}. Make sure you have set up GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env.local file.`);
        return;
      }
      
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        alert('Failed to get authentication URL. Please check your configuration.');
      }
    } catch (error: any) {
      console.error('Error connecting to Google Calendar:', error);
      const errorMessage = error.message || 'Network error';
      alert(`Failed to connect to Google Calendar: ${errorMessage}. Make sure the dev server is running and API routes are accessible.`);
    }
  };

  // Disconnect from Google Calendar
  const handleDisconnectGoogle = () => {
    storage.clearGoogleTokens();
    setGoogleConnected(false);
    setGoogleEvents([]);
    setGooglePushError(null);
    setGooglePushedCount(null);
    setSelectedGoogleCalendarIds(['primary']);
    setGoogleCalendarColors({});
    setShowGoogleCalendarsDialog(false);
  };

  // Force a fresh OAuth consent (needed after the write scope was added, so the
  // app gets calendar.events access + a refresh token and can create the calendar).
  const handleReconnectGoogle = () => {
    storage.clearGoogleTokens();
    setGoogleConnected(false);
    void handleConnectGoogle();
  };

  const loadGoogleCalendarList = async (): Promise<boolean> => {
    if (!googleTokensIndicateConnection(storage.getGoogleTokens())) return false;

    setIsLoadingGoogleCalendars(true);
    try {
      let accessToken = storage.getGoogleTokens()?.access_token;
      if (!accessToken) {
        accessToken = (await refreshGoogleAccessTokenClient()) ?? undefined;
      }
      if (!accessToken) {
        setGooglePushError(m.feed.googleReconnect);
        return false;
      }

      const fetchList = (token: string) =>
        fetch(`/api/google/calendars?access_token=${encodeURIComponent(token)}`);

      let response = await fetchList(accessToken);
      if (response.status === 401) {
        const refreshed = await refreshGoogleAccessTokenClient();
        if (refreshed) {
          accessToken = refreshed;
          response = await fetchList(refreshed);
        }
      }

      if (!response.ok) {
        if (response.status === 401) {
          handleDisconnectGoogle();
          setGooglePushError(m.feed.googleReconnect);
        }
        return false;
      }

      const data = await response.json();
      const calendars = Array.isArray(data.calendars) ? data.calendars : [];
      setGoogleCalendarList(calendars);

      const saved = storage.getGoogleSelectedCalendarIds();
      const primary = calendars.find(
        (c: { primary?: boolean }) => c.primary
      ) as { id: string } | undefined;
      const normalized = saved.map((id) =>
        id === 'primary' && primary?.id ? primary.id : id
      );
      const valid = normalized.filter((id) =>
        calendars.some((c: { id: string }) => c.id === id)
      );
      const nextIds =
        valid.length > 0 ? valid : primary?.id ? [primary.id] : ['primary'];
      setSelectedGoogleCalendarIds(nextIds);
      storage.saveGoogleSelectedCalendarIds(nextIds);

      // Seed colors from Google when the user hasn't picked one yet.
      const colors = { ...storage.getGoogleCalendarColors() };
      let colorsChanged = false;
      for (const cal of calendars as Array<{
        id: string;
        backgroundColor?: string;
      }>) {
        if (!colors[cal.id] && cal.backgroundColor) {
          colors[cal.id] = cal.backgroundColor;
          colorsChanged = true;
        }
      }
      if (colorsChanged) {
        storage.saveGoogleCalendarColors(colors);
      }
      setGoogleCalendarColors(colors);
      return true;
    } catch (error) {
      console.error('Error listing Google calendars:', error);
      return false;
    } finally {
      setIsLoadingGoogleCalendars(false);
    }
  };

  const openGoogleCalendarsDialog = async () => {
    if (!googleConnected) {
      void handleConnectGoogle();
      return;
    }
    setShowGoogleCalendarsDialog(true);
    const ok = await loadGoogleCalendarList();
    if (!ok) setShowGoogleCalendarsDialog(false);
  };

  const openSubscriptionDialog = () => {
    const next = !showSubscriptionDialog;
    setShowSubscriptionDialog(next);
    if (next && googleConnected) {
      void loadGoogleCalendarList();
    }
  };

  const toggleGoogleCalendarEnabled = (calendarId: string) => {
    setSelectedGoogleCalendarIds((prev) => {
      const next = prev.includes(calendarId)
        ? prev.filter((id) => id !== calendarId)
        : [...prev, calendarId];
      storage.saveGoogleSelectedCalendarIds(next);
      void fetchGoogleCalendarEvents();
      return next;
    });
  };

  const toggleGoogleCalendarSelection = (calendarId: string) => {
    setSelectedGoogleCalendarIds((prev) =>
      prev.includes(calendarId)
        ? prev.filter((id) => id !== calendarId)
        : [...prev, calendarId]
    );
  };

  const saveGoogleCalendarSelection = () => {
    const ids =
      selectedGoogleCalendarIds.length > 0
        ? selectedGoogleCalendarIds
        : ['primary'];
    storage.saveGoogleSelectedCalendarIds(ids);
    setSelectedGoogleCalendarIds(ids);
    setShowGoogleCalendarsDialog(false);
    void fetchGoogleCalendarEvents();
  };

  const handleSetGoogleCalendarColor = (calendarId: string, color: string) => {
    setOpenColorMenuId(null);
    const next = storage.setGoogleCalendarColor(calendarId, color);
    setGoogleCalendarColors(next);
    if (selectedGoogleCalendarIds.includes(calendarId)) {
      void fetchGoogleCalendarEvents();
    }
  };

  const resolveGoogleCalendarColor = (cal: {
    id: string;
    backgroundColor?: string;
  }) => googleCalendarColors[cal.id] || cal.backgroundColor || '#4285f4';

  // Handle ICS file import
  const handleImportICS = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.ics') && !file.type.includes('calendar')) {
      alert('Please select a valid ICS calendar file (.ics)');
      return;
    }

    setIsImportingICS(true);
    try {
      const importedEvents = await parseICSFileFromFile(file);
      
      if (importedEvents.length === 0) {
        alert('No events found in the ICS file.');
      } else {
        // Merge with existing events (avoid duplicates by checking IDs)
        const existingIds = new Set(events.map(e => e.id));
        const newEvents = importedEvents.filter(e => !existingIds.has(e.id));
        
        setEvents([...events, ...newEvents]);
        alert(`Successfully imported ${newEvents.length} event(s) from ${file.name}`);
      }
    } catch (error: any) {
      console.error('Error importing ICS file:', error);
      alert(`Failed to import ICS file: ${error.message || 'Unknown error'}`);
    } finally {
      setIsImportingICS(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // Handle ICS file import as tasks
  const handleImportTasksFromICS = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.ics') && !file.type.includes('calendar')) {
      alert('Please select a valid ICS calendar file (.ics)');
      return;
    }

    setIsImportingICS(true);
    try {
      const importedTasks = await parseICSFileFromFileAsTasks(file);
      
      if (importedTasks.length === 0) {
        alert('No tasks found in the ICS file.');
      } else {
        // Add each imported task
        for (const taskData of importedTasks) {
          await handleAddTask(taskData, { useAiBreakdown: false });
        }
        alert(`Successfully imported ${importedTasks.length} task(s) from ${file.name}`);
      }
    } catch (error: any) {
      console.error('Error importing tasks from ICS file:', error);
      alert(`Failed to import tasks from ICS file: ${error.message || 'Unknown error'}`);
    } finally {
      setIsImportingICS(false);
      // Reset file input
      if (tasksFileInputRef.current) {
        tasksFileInputRef.current.value = '';
      }
    }
  };

  const triggerTasksFileInput = () => {
    tasksFileInputRef.current?.click();
  };

  // Fetch all ICS subscriptions
  const fetchAllICSSubscriptions = async (
    subscriptions: Array<{ id: string; url: string; name: string; color?: string }> = icsSubscriptions
  ) => {
    setIsLoadingICSSubscription(true);
    try {
      const allEvents: CalendarEvent[] = [];
      
      await Promise.all(
        subscriptions.map(async (subscription, index) => {
          try {
            const events = await fetchICSFromURL(subscription.url);
            // Tag events with subscription ID to differentiate them
            const taggedEvents = events.map(event => ({
              ...event,
              id: `ics-sub-${subscription.id}-${event.id}`,
              color:
                subscription.color ||
                ICS_SUBSCRIPTION_COLORS[index % ICS_SUBSCRIPTION_COLORS.length],
            }));
            allEvents.push(...taggedEvents);
          } catch (error) {
            console.error(`Failed to fetch subscription ${subscription.name}:`, error);
          }
        })
      );
      
      setICSSubscribedEvents(allEvents);
    } catch (error) {
      console.error('Error fetching ICS subscriptions:', error);
    } finally {
      setIsLoadingICSSubscription(false);
    }
  };

  // Add new ICS subscription
  const handleAddICSSubscription = async () => {
    if (!newSubscriptionUrl.trim()) {
      alert('Please enter a calendar URL');
      return;
    }

    try {
      // Normalize and validate URL
      const rawUrl = newSubscriptionUrl.trim();
      let finalUrl = rawUrl;
      let displayName = newSubscriptionName.trim();
      let urlObj = new URL(rawUrl);

      // Support Google Calendar embed URLs by converting them to ICS feed URLs
      if (
        urlObj.hostname === 'calendar.google.com' &&
        urlObj.pathname.startsWith('/calendar/embed')
      ) {
        const src = urlObj.searchParams.get('src');
        if (src) {
          const encodedSrc = encodeURIComponent(src);
          finalUrl = `https://calendar.google.com/calendar/ical/${encodedSrc}/public/basic.ics`;
          urlObj = new URL(finalUrl);

          if (!displayName) {
            displayName = src.includes('@') ? src.split('@')[0] : src;
          }
        }
      }
      
      // Only allow HTTPS for security
      if (urlObj.protocol !== 'https:') {
        alert('Only HTTPS URLs are supported for security reasons');
        return;
      }
      
      // Test fetch to make sure it works
      setIsLoadingICSSubscription(true);
      await fetchICSFromURL(finalUrl);
      
      // Add subscription (color will be auto-assigned from palette)
      const name = displayName || urlObj.hostname;
      storage.addICSSubscription(finalUrl, name);
      
      const updatedSubscriptions = storage.getICSSubscriptions();
      setICSSubscriptions(updatedSubscriptions);
      
      // Fetch events from new subscription
      await fetchAllICSSubscriptions(updatedSubscriptions);
      
      setNewSubscriptionUrl('');
      setNewSubscriptionName('');
      setShowSubscriptionDialog(false);
      alert('Calendar subscription added successfully!');
    } catch (error: any) {
      console.error('Error adding subscription:', error);
      const errorMessage = error.message || 'Unknown error';
      alert(`Failed to add subscription: ${errorMessage}\n\nCommon issues:\n- Invalid URL format\n- Calendar feed not publicly accessible\n- CORS restrictions\n- Network connectivity issues`);
    } finally {
      setIsLoadingICSSubscription(false);
    }
  };

  // Remove ICS subscription
  const handleRemoveICSSubscription = async (id: string) => {
    storage.removeICSSubscription(id);
    const updatedSubscriptions = storage.getICSSubscriptions();
    setICSSubscriptions(updatedSubscriptions);
    
    // Remove events from this subscription
    setICSSubscribedEvents(icsSubscribedEvents.filter(e => !e.id.startsWith(`ics-sub-${id}-`)));
    
    // Refresh remaining subscriptions
    if (updatedSubscriptions.length > 0) {
      await fetchAllICSSubscriptions(updatedSubscriptions);
    } else {
      setICSSubscribedEvents([]);
    }
  };

  // Set color of an ICS subscription (from palette or custom picker)
  const handleSetICSSubscriptionColor = (id: string, color: string) => {
    setOpenColorMenuId(null);
    setICSSubscriptions(prev => {
      const updated = prev.map(sub =>
        sub.id === id ? { ...sub, color } : sub
      );
      storage.saveICSSubscriptions(updated);
      fetchAllICSSubscriptions(updated);
      return updated;
    });
  };

  // Save to localStorage whenever data changes
  useEffect(() => {
    storage.saveTasks(tasks);
  }, [tasks]);

  useEffect(() => {
    storage.saveEvents(events);
  }, [events]);

  useEffect(() => {
    storage.saveNotifications(notifications);
  }, [notifications]);

  const feedPublishPreviewCount = useMemo(
    () => filterEventsForCalendarFeed(events).length,
    [events]
  );

  const devUsesPublicCadenceFeed =
    typeof window !== 'undefined' && isLocalhostFeedOrigin(window.location.origin);

  const runCalendarFeedSync = async (
    token: string,
    eventsToSync: CalendarEvent[],
    username?: string,
    revokeToken?: string
  ) => {
    setFeedSyncing(true);
    const result = await syncCalendarFeedToServer(token, eventsToSync, username, revokeToken);
    setFeedSyncing(false);
    if (result.ok) {
      setFeedSyncError(null);
      setFeedSyncedEventCount(
        result.eventCount ?? filterEventsForCalendarFeed(eventsToSync).length
      );
    } else {
      setFeedSyncError(result.error ?? m.alerts.feedSyncFailed);
    }
    return result;
  };

  /** Push feed to server immediately (ICS subscribers see updates after their next poll). */
  const pushCalendarFeedSync = (eventsList: CalendarEvent[]) => {
    if (!authReady || !initialAppDataLoadedRef.current) return;
    const profile = userProfileRef.current ?? storage.getUserProfile();
    if (!profile) return;
    const token = profile.calendarFeedToken ?? storage.ensureCalendarFeedToken();
    if (!token) return;
    void runCalendarFeedSync(token, eventsList, profile.username);
  };

  /**
   * Push Cadence events directly into the user's Google Calendar via the API
   * (OAuth). Unlike the ICS feed, this reflects adds/completes/deletes within
   * seconds. No-op when Google isn't connected.
   */
  const pushGoogleCalendar = async (eventsList: CalendarEvent[], manual = false) => {
    if (!initialAppDataLoadedRef.current) return;
    const tokens = storage.getGoogleTokens();
    if (!tokens || !googleTokensIndicateConnection(tokens)) return;

    if (manual) setGoogleSyncing(true);
    try {
      const res = await fetch('/api/calendar/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          calendarId: tokens.calendar_id,
          events: serializeFeedEvents(eventsList),
        }),
      });
      const data = await res.json().catch(() => ({} as Record<string, unknown>));
      if (res.ok) {
        const update: { access_token?: string; calendar_id?: string } = {};
        if (typeof data.accessToken === 'string') update.access_token = data.accessToken;
        if (typeof data.calendarId === 'string') update.calendar_id = data.calendarId;
        if (Object.keys(update).length > 0) storage.saveGoogleTokens(update);
        setGooglePushError(null);
        setGooglePushedCount(serializeFeedEvents(eventsList).length);
      } else if (res.status === 401) {
        setGooglePushError(m.feed.googleReconnect);
      } else {
        setGooglePushError((data.error as string) ?? m.feed.googlePushFailed);
      }
    } catch {
      setGooglePushError(m.feed.googlePushFailed);
    } finally {
      if (manual) setGoogleSyncing(false);
    }
  };

  useEffect(() => {
    if (!authReady) return;
    void probePublicCalendarFeedHealth().then(setPublicFeedDeployed);
  }, [authReady]);

  useEffect(() => {
    if (!authReady || !userProfile) return;
    const token = storage.ensureCalendarFeedToken();
    if (!token) return;
    setCalendarFeedUrl(buildCalendarFeedUrl(getCalendarFeedSubscriptionOrigin(), token));
    const refreshed = storage.getUserProfile();
    if (refreshed && refreshed.calendarFeedToken !== userProfile.calendarFeedToken) {
      setUserProfile(refreshed);
    }
  }, [authReady, userProfile?.calendarFeedToken, publicFeedDeployed]);

  useEffect(() => {
    if (!authReady || !userProfile || !initialAppDataLoadedRef.current) return;
    const token = userProfile.calendarFeedToken ?? storage.ensureCalendarFeedToken();
    if (!token) return;

    const timer = window.setTimeout(() => {
      void runCalendarFeedSync(token, events, userProfile.username);
    }, 50);

    return () => window.clearTimeout(timer);
  }, [events, authReady, userProfile?.username, userProfile?.calendarFeedToken]);

  // When Google is connected, push adds/completes/deletes straight into the
  // user's Cadence Google calendar (debounced to coalesce rapid changes).
  useEffect(() => {
    if (!authReady || !initialAppDataLoadedRef.current || !googleConnected) return;
    const timer = window.setTimeout(() => {
      void pushGoogleCalendar(events);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [events, authReady, googleConnected]);

  // Merge all events for display. Cadence (local) events must come **last** so react-big-calendar
  // paints them above Google/ICS when times overlap; otherwise task blocks sit underneath and look missing.
  const allEvents = useMemo(() => {
    const localEvents = events.filter(e => !e.id.startsWith('google-') && !e.id.startsWith('ics-sub-'));
    return [...googleEvents, ...icsSubscribedEvents, ...localEvents];
  }, [events, googleEvents, icsSubscribedEvents]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tasksDropdownRef.current && !tasksDropdownRef.current.contains(event.target as Node)) {
        setTasksDropdownOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close subscription color palette when clicking outside
  useEffect(() => {
    if (!openColorMenuId) return;
    const close = (e: MouseEvent) => {
      if (subscriptionColorMenuRef.current && !subscriptionColorMenuRef.current.contains(e.target as Node)) {
        setOpenColorMenuId(null);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [openColorMenuId]);

  const enqueueCadenceNotificationsForEvents = (scheduled: CalendarEvent[]) => {
    // Only notify for events created by Cadence itself: scheduled task blocks with a taskId.
    const cadenceEvents = scheduled.filter((e) => Boolean(e.taskId));
    if (cadenceEvents.length === 0) return;

    const createdAt = new Date();
    const next: InAppNotification[] = cadenceEvents.map((e) => ({
      id: `notif:${e.id}`,
      kind: 'cadence_subtask_scheduled',
      title: `Scheduled: ${e.title}`,
      body: `${e.start.toLocaleString()} → ${e.end.toLocaleString()}`,
      createdAt,
      eventId: e.id,
      taskId: e.taskId,
    }));

    setNotifications((prev) => {
      const seen = new Set(prev.map((n) => n.id));
      const merged = [...prev];
      for (const n of next) {
        if (!seen.has(n.id)) {
          merged.push(n);
          seen.add(n.id);
        }
      }
      merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return merged;
    });
  };

  const copyCalendarFeedLink = async () => {
    if (!calendarFeedUrl) return;
    try {
      await navigator.clipboard.writeText(calendarFeedUrl);
      setFeedLinkCopied(true);
      window.setTimeout(() => setFeedLinkCopied(false), 2000);
    } catch {
      alert(calendarFeedUrl);
    }
  };

  const rotateCalendarFeedLink = async () => {
    if (!userProfile) return;
    if (!confirm(m.alerts.confirmNewFeedLink)) {
      return;
    }
    const oldToken = userProfile.calendarFeedToken;
    const token = storage.regenerateCalendarFeedToken();
    if (!token) return;
    const updated = storage.getUserProfile();
    if (updated) setUserProfile(updated);
    const url = buildCalendarFeedUrl(getCalendarFeedSubscriptionOrigin(), token);
    setCalendarFeedUrl(url);
    await runCalendarFeedSync(token, events, updated?.username, oldToken);
  };

  const manualSyncCalendarFeed = async () => {
    if (!userProfile) return;
    const token = userProfile.calendarFeedToken ?? storage.ensureCalendarFeedToken();
    if (!token) return;
    await runCalendarFeedSync(token, events, userProfile.username);
  };

  const handleAddTask = async (
    taskData: {
      title: string;
      description?: string;
      estimatedDuration?: number;
      priority: 'low' | 'medium' | 'high';
      category?: string;
      dueDate?: string;
    },
    options?: { useAiBreakdown?: boolean }
  ) => {
    const description = taskData.description?.trim() || undefined;
    const useAi =
      options?.useAiBreakdown ??
      (breakDownNewTaskWithAi && Boolean(description));

    if (useAi) {
      setIsDecomposingNewTask(true);
      try {
        const newTasks = await createTasksFromAiBreakdown({
          title: taskData.title,
          description,
          dueDate: taskData.dueDate,
          priority: taskData.priority,
          category: taskData.category,
        });

        setTasks((prev) => [...prev, ...newTasks]);
        setNewTask({
          title: '',
          description: '',
          estimatedDuration: 60,
          priority: 'medium',
          category: '',
          dueDate: undefined,
        });
        setIsAddingTask(false);
        setShowAddTaskDialog(false);
        setTaskDurationMode('preset');

        if (autoScheduleNewTask) {
          scheduleTasks(newTasks);
        }
      } catch (e) {
        console.error(e);
        alert(e instanceof Error ? e.message : m.addTask.aiFailed);
      } finally {
        setIsDecomposingNewTask(false);
      }
      return;
    }

    const newTask: Task = {
      title: taskData.title,
      description: taskData.description,
      estimatedDuration: CalendarAIAgent.coerceEstimatedMinutes(taskData.estimatedDuration),
      priority: taskData.priority,
      category: taskData.category,
      dueDate: taskData.dueDate ? parseLocalDateInput(taskData.dueDate) : undefined,
      id: uuidv4(),
      createdAt: new Date(),
      actualDurations: [],
    };
    const updatedTasks = [...tasks, newTask];
    setTasks(updatedTasks);
    setNewTask({
      title: '',
      description: '',
      estimatedDuration: 60,
      priority: 'medium',
      category: '',
      dueDate: undefined,
    });
    setIsAddingTask(false);
    setShowAddTaskDialog(false);
    setTaskDurationMode('preset');

    // Automatically schedule the newly created task if auto schedule is toggled
    if (autoScheduleNewTask) {
      scheduleNewTask(newTask);
    }
  };

  const createTasksFromAiBreakdown = async (input: {
    title: string;
    description?: string;
    dueDate?: string | Date;
    priority?: 'low' | 'medium' | 'high';
    category?: string;
  }): Promise<Task[]> => {
    const dueIso =
      input.dueDate instanceof Date
        ? input.dueDate.toISOString()
        : typeof input.dueDate === 'string' && input.dueDate
          ? input.dueDate
          : undefined;

    const res = await fetch('/api/assignments/decompose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        description: htmlToReadableText(input.description) || undefined,
        dueDate: dueIso,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Request failed: ${res.status}`);
    }
    const { subtasks } = await res.json();
    if (!Array.isArray(subtasks) || subtasks.length === 0) {
      throw new Error('No subtasks returned');
    }

    let calibrationByUnit: CalibrationByUnit = storage.getLocalCalibration();
    try {
      const accessToken = await getGoogleAccessTokenForLearning();
      if (accessToken) {
        const profile = await fetchLearningProfile(accessToken);
        if (profile?.calibrationByUnit) {
          calibrationByUnit = profile.calibrationByUnit;
        }
      }
    } catch {
      // keep local calibration
    }

    const calibrated = calibrateSubtaskEstimates(subtasks, calibrationByUnit);
    const ordered = [...calibrated].sort(
      (a: { order: number }, b: { order: number }) => a.order - b.order
    );
    const planId = uuidv4();
    const assignmentDue = dueIso
      ? parseLocalDateInput(
          dueIso.includes('T')
            ? formatDateToLocalISO(new Date(dueIso))
            : dueIso.slice(0, 10)
        )
      : undefined;

    return ordered.map(
      (st: {
        title: string;
        description?: string;
        estimatedMinutes?: number;
        workAmount?: number;
        workUnit?: string;
        order: number;
      }) => ({
        id: uuidv4(),
        title: st.title,
        description: st.description,
        estimatedDuration: st.estimatedMinutes ?? 60,
        priority: input.priority ?? ('medium' as const),
        category: input.category ?? '',
        dueDate: assignmentDue,
        planStepOrder: st.order,
        planId,
        procedureTitle: st.title,
        procedureDescription: st.description,
        ...(st.workAmount !== undefined && st.workUnit
          ? { workAmount: st.workAmount, workUnit: st.workUnit }
          : {}),
        createdAt: new Date(),
        actualDurations: [],
      })
    );
  };

  const scheduleTasks = (tasksToSchedule: Task[]) => {
    const incomplete = tasksToSchedule.filter((t) => !t.completedAt);
    if (incomplete.length === 0) return;

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = CalendarAIAgent.computeScheduleEndDate(incomplete, startDate);

    setEvents((prevEvents) => {
      const allExistingEvents = dedupeCalendarEventsById([
        ...prevEvents,
        ...googleEventsRef.current,
        ...icsSubscribedEventsRef.current,
      ]);

      const segments =
        workHours.segments.length > 0 &&
        workHours.segments.some((s) => s.startHour < s.endHour)
          ? workHours.segments
          : storage.getWorkHours().segments;

      const breakMinutes = storage.getBreakAfterEvents();
      const focusMinutes = storage.getFocusMinutes();
      const scheduledEvents = CalendarAIAgent.distributeTasks(
        incomplete,
        allExistingEvents,
        startDate,
        endDate,
        segments,
        breakMinutes,
        focusMinutes
      );

      if (scheduledEvents.length > 0) {
        enqueueCadenceNotificationsForEvents(scheduledEvents);
        const next = [...prevEvents, ...scheduledEvents];
        pushCalendarFeedSync(next);
        return next;
      }

      return prevEvents;
    });
  };

  // Schedule a single new task immediately
  const scheduleNewTask = (task: Task) => {
    scheduleTasks([task]);
  };

  // Auto-distribute tasks function (for manual distribution)
  const autoDistributeTasks = async (tasksToSchedule: Task[] = tasks) => {
    const incompleteTasks = tasksToSchedule.filter(task => !task.completedAt);
    
    if (incompleteTasks.length === 0) {
      return; // No tasks to schedule
    }

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = CalendarAIAgent.computeScheduleEndDate(incompleteTasks, startDate);

    // Get current events using functional update to ensure we have latest state
    setEvents(currentEvents => {
      const allExistingEvents = dedupeCalendarEventsById([
        ...currentEvents,
        ...googleEvents,
        ...icsSubscribedEvents,
      ]);

      // Filter out already scheduled tasks (those with taskId in events)
      const scheduledTaskIds = new Set(currentEvents.filter(e => e.taskId).map(e => e.taskId));
      const unscheduledTasks = incompleteTasks.filter(task => !scheduledTaskIds.has(task.id));
      
      if (unscheduledTasks.length === 0) {
        return currentEvents; // All tasks already scheduled
      }

      const segments =
        workHours.segments.length > 0 &&
        workHours.segments.some((s) => s.startHour < s.endHour)
          ? workHours.segments
          : storage.getWorkHours().segments;

      const breakMinutes = storage.getBreakAfterEvents();
      const focusMinutes = storage.getFocusMinutes();
      const scheduledEvents = CalendarAIAgent.distributeTasks(
        unscheduledTasks,
        allExistingEvents,
        startDate,
        endDate,
        segments,
        breakMinutes,
        focusMinutes
      );

      if (scheduledEvents.length > 0) {
        enqueueCadenceNotificationsForEvents(scheduledEvents);
        const next = [...currentEvents, ...scheduledEvents];
        pushCalendarFeedSync(next);
        return next;
      }
      
      return currentEvents;
    });
  };

  const handleDeleteTask = (taskId: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
    setEvents((prev) => {
      const next = prev.filter((event) => event.taskId !== taskId);
      pushCalendarFeedSync(next);
      return next;
    });
  };

  const getInferredCompletionMinutes = (
    taskId: string
  ): { minutes: number; source: 'scheduled_block' | 'estimate' } => {
    const task = tasks.find((t) => t.id === taskId);
    // Prefer AI / task estimate when available (especially for AI-broken-down steps).
    if (task?.estimatedDuration && task.estimatedDuration > 0) {
      return {
        minutes: Math.max(1, Math.round(task.estimatedDuration)),
        source: 'estimate',
      };
    }
    const linked = events.filter((e) => e.taskId === taskId);
    if (linked.length > 0) {
      const totalMs = linked.reduce(
        (sum, e) => sum + Math.max(0, e.end.getTime() - e.start.getTime()),
        0
      );
      const minutes = Math.max(1, Math.round(totalMs / (1000 * 60)));
      return { minutes, source: 'scheduled_block' };
    }
    return { minutes: 60, source: 'estimate' };
  };

  const getSuggestedCompletionMinutes = (taskId: string): number => {
    const task = tasks.find((t) => t.id === taskId);
    if (task?.estimatedDuration && task.estimatedDuration > 0) {
      return Math.max(1, Math.round(task.estimatedDuration));
    }
    return getInferredCompletionMinutes(taskId).minutes;
  };

  const handleCompleteTask = (
    taskId: string,
    actualDuration: number,
    durationSource: 'self_report' | 'scheduled_block' | 'estimate' = 'self_report'
  ) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const updatedTask = CalendarAIAgent.recordTaskCompletion(task, actualDuration);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updatedTask : t)));
    setEvents((prev) => {
      const next = prev.filter((event) => event.taskId !== taskId);
      pushCalendarFeedSync(next);
      return next;
    });
    setCompletingTaskId(null);
    setCompletionDurationInput('');
    setCompletionDontAskAgain(false);

    // Anonymous duration telemetry (never block completion on failure)
    try {
      const anonymousSessionId = storage.getOrCreateAnonymousSessionId();
      if (anonymousSessionId) {
        void fetch('/api/telemetry/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            schemaVersion: updatedTask.workAmount !== undefined ? 2 : 1,
            anonymousSessionId,
            planId: updatedTask.planId,
            planStepOrder: updatedTask.planStepOrder,
            isAiBreakdown: Boolean(
              updatedTask.planId || updatedTask.planStepOrder !== undefined
            ),
            procedureTitle: updatedTask.procedureTitle ?? updatedTask.title,
            procedureDescription: updatedTask.procedureDescription ?? updatedTask.description,
            estimatedMinutes: updatedTask.estimatedDuration,
            actualMinutes: actualDuration,
            durationSource,
            ...(updatedTask.workAmount !== undefined && updatedTask.workUnit
              ? {
                  workAmount: updatedTask.workAmount,
                  workUnit: updatedTask.workUnit,
                }
              : {}),
            completedAt: (updatedTask.completedAt ?? new Date()).toISOString(),
          }),
        }).catch((err) => {
          console.warn('completion telemetry failed', err);
        });
      }
    } catch (err) {
      console.warn('completion telemetry failed', err);
    }

    // Per-user estimate calibration (local always; Google profile when signed in)
    const estimatedMinutes = updatedTask.estimatedDuration;
    if (estimatedMinutes && estimatedMinutes > 0) {
      storage.recordLocalCalibrationFromCompletion({
        actualMinutes: actualDuration,
        estimatedMinutes,
        workUnit: updatedTask.workUnit,
      });
      void (async () => {
        try {
          const accessToken = await getGoogleAccessTokenForLearning();
          if (!accessToken) return;
          await postLearningCalibration(accessToken, {
            actualMinutes: actualDuration,
            estimatedMinutes,
            workUnit: updatedTask.workUnit,
          });
        } catch (err) {
          console.warn('learning calibration failed', err);
        }
      })();
    }
  };

  const requestCompleteTask = (taskId: string) => {
    if (skipDurationPrompt || storage.getSkipDurationPrompt()) {
      const inferred = getInferredCompletionMinutes(taskId);
      handleCompleteTask(taskId, inferred.minutes, inferred.source);
      return;
    }
    setCompletingTaskId(taskId);
    setCompletionDurationInput(String(getSuggestedCompletionMinutes(taskId)));
    setCompletionDontAskAgain(false);
  };

  const submitCompletionWithReport = () => {
    if (!completingTaskId) return;
    const parsed = parseInt(completionDurationInput, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    if (completionDontAskAgain) {
      storage.saveSkipDurationPrompt(true);
      setSkipDurationPrompt(true);
      setTempSkipDurationPrompt(true);
    }
    handleCompleteTask(completingTaskId, parsed, 'self_report');
  };

  const skipCompletionQuestionnaire = () => {
    if (!completingTaskId) return;
    if (completionDontAskAgain) {
      storage.saveSkipDurationPrompt(true);
      setSkipDurationPrompt(true);
      setTempSkipDurationPrompt(true);
    }
    const inferred = getInferredCompletionMinutes(completingTaskId);
    handleCompleteTask(completingTaskId, inferred.minutes, inferred.source);
  };

  const handleScheduleTasks = (scheduledEvents: CalendarEvent[]) => {
    setEvents([...events, ...scheduledEvents]);
  };

  const handleAnalyze = () => {
    const taskStats = CalendarAIAgent.getTaskDurationStats(tasks);
    setStats(taskStats);
  };

  const handleDistribute = async () => {
    setIsProcessing(true);
    await autoDistributeTasks();
    
    const incompleteTasks = tasks.filter(task => !task.completedAt);
    if (incompleteTasks.length === 0) {
      alert(m.alerts.noTasksToSchedule);
    } else {
      alert(m.alerts.tasksDistributed);
    }

    setIsProcessing(false);
  };

  const handleSelectSlot = (slot: { start: Date; end: Date }) => {
    const title = prompt('Enter event title:');
    if (title) {
      const newEvent: CalendarEvent = {
        id: uuidv4(),
        title,
        start: slot.start,
        end: slot.end,
        isScheduled: false,
        color: icsSubscriptions[0]?.color || '#e5dfff',
      };
      setEvents([...events, newEvent]);
    }
  };

  const handleSelectEvent = (event: CalendarEvent) => {
    setSelectedEvent(event);
    // Calculate suggested duration from event
    const durationMs = event.end.getTime() - event.start.getTime();
    const durationMinutes = Math.round(durationMs / (1000 * 60));
    // Set default duration (use calculated if > 0, otherwise 60 minutes)
    setConversionDuration(durationMinutes > 0 && durationMinutes < 1440 ? durationMinutes : 60);
    setShowEventDialog(true);
  };

  const isValidWorkHours = (config: { segments: { startHour: number; endHour: number }[] }) => {
    if (!config || !Array.isArray(config.segments) || config.segments.length === 0) {
      return false;
    }
    return config.segments.every(
      (segment) => typeof segment.startHour === 'number' && typeof segment.endHour === 'number' && segment.startHour < segment.endHour
    );
  };

  const isTempWorkHoursValid = isValidWorkHours(tempWorkHours);

  // Convert event to task
  const handleConvertEventToTask = async (event: CalendarEvent) => {
    // Use the user-specified duration
    const dueDate = event.start;
    
    // Create task from event
    const taskData = {
      title: event.title,
      description: htmlToReadableText(event.description) || undefined,
      estimatedDuration: conversionDuration,
      priority: 'medium' as const,
      category: '',
      dueDate: formatDateToLocalISO(dueDate), // Format as YYYY-MM-DD in device local timezone
    };

    // Create the task object
    const newTask: Task = {
      title: taskData.title,
      description: taskData.description,
      estimatedDuration: CalendarAIAgent.coerceEstimatedMinutes(taskData.estimatedDuration),
      priority: taskData.priority,
      category: taskData.category,
      dueDate: taskData.dueDate ? parseLocalDateInput(taskData.dueDate) : undefined,
      id: uuidv4(),
      createdAt: new Date(),
      actualDurations: [],
    };

    // Add task to state
    const updatedTasks = [...tasks, newTask];
    setTasks(updatedTasks);

    // Close dialog first
    setShowEventDialog(false);
    setSelectedEvent(null);
    setConversionDuration(60); // Reset to default

    // Schedule the task immediately
    scheduleNewTask(newTask);
    
    // Optionally remove the event (or keep it)
    if (confirm('Task created and scheduled! Do you want to remove this event from the calendar?')) {
      setEvents(prevEvents => prevEvents.filter(e => e.id !== event.id));
      // Also remove from Google events or ICS subscribed events if applicable
      setGoogleEvents(prevEvents => prevEvents.filter(e => e.id !== event.id));
      setICSSubscribedEvents(prevEvents => prevEvents.filter(e => e.id !== event.id));
    }
  };

  // Break down event into steps using AI (reads description, creates subtasks, schedules them)
  const handleBreakDownWithAI = async (event: CalendarEvent) => {
    setIsDecomposingEvent(true);
    try {
      const newTasks = await createTasksFromAiBreakdown({
        title: event.title,
        description: event.description,
        dueDate: event.start,
        priority: 'medium',
      });

      scheduleTasks(newTasks);
      setTasks((prev) => [...prev, ...newTasks]);

      setShowEventDialog(false);
      setSelectedEvent(null);
      if (confirm(`${newTasks.length} subtasks created and scheduled. Remove this event from the calendar?`)) {
        setEvents((prevEvents) => prevEvents.filter((e) => e.id !== event.id));
        setGoogleEvents((prevEvents) => prevEvents.filter((e) => e.id !== event.id));
        setICSSubscribedEvents((prevEvents) => prevEvents.filter((e) => e.id !== event.id));
      }
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : 'Failed to break down with AI. Is Ollama running?');
    } finally {
      setIsDecomposingEvent(false);
    }
  };

  // Delete event
  const handleDeleteEvent = (event: CalendarEvent) => {
    if (confirm(m.eventDialog.confirmDelete)) {
      setEvents(events.filter(e => e.id !== event.id));
      // Also remove from other event sources if applicable
      setGoogleEvents(googleEvents.filter(e => e.id !== event.id));
      setICSSubscribedEvents(icsSubscribedEvents.filter(e => e.id !== event.id));
    }
    setShowEventDialog(false);
    setSelectedEvent(null);
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return {
          text: 'text-red-700',
          dot: 'bg-red-500',
        };
      case 'medium':
        return {
          text: 'text-amber-700',
          dot: 'bg-amber-500',
        };
      case 'low':
        return {
          text: 'text-emerald-700',
          dot: 'bg-emerald-500',
        };
      default:
        return {
          text: 'text-gray-700',
          dot: 'bg-gray-500',
        };
    }
  };

  const getAverageDuration = (task: Task) => {
    if (task.actualDurations.length === 0) {
      return task.estimatedDuration || 60;
    }
    const sum = task.actualDurations.reduce((acc, d) => acc + d, 0);
    return Math.round(sum / task.actualDurations.length);
  };

  const incompleteTasksCount = tasks.filter(t => !t.completedAt).length;
  const activeTasks = tasks.filter(task => !task.completedAt);
  const completedTasks = tasks.filter(task => task.completedAt);
  const displayedTasks = taskSidebarTab === 'active' ? activeTasks : completedTasks;

  // Mini calendar display data
  const miniCalendarYear = miniCalendarDate.getFullYear();
  const miniCalendarMonth = miniCalendarDate.getMonth();

  const miniCalendarMonthLabel = miniCalendarDate.toLocaleDateString(dateLocale, {
  month: 'long',
  year: 'numeric',
  });

  const firstDayOfMonth = new Date(miniCalendarYear, miniCalendarMonth, 1);
  const lastDayOfMonth = new Date(miniCalendarYear, miniCalendarMonth + 1, 0);

  const startDay = firstDayOfMonth.getDay();
  const daysInMonth = lastDayOfMonth.getDate();

  const miniCalendarDays = Array.from({ length: 42 }, (_, index) => {
    const dayNumber = index - startDay + 1;

    if (dayNumber < 1 || dayNumber > daysInMonth) {
      return null;
    }

    return dayNumber;
  });

  const today = new Date();
  const isCurrentMiniCalendarMonth =
    today.getFullYear() === miniCalendarYear &&
    today.getMonth() === miniCalendarMonth;

  const goToPreviousMiniMonth = () => {
    setMiniCalendarDate(new Date(miniCalendarYear, miniCalendarMonth - 1, 1));
  };

  const goToNextMiniMonth = () => {
    setMiniCalendarDate(new Date(miniCalendarYear, miniCalendarMonth + 1, 1));
  };

  const getCalendarHeaderLabel = (date: Date) => {
    if (calendarView === 'month') {
      return {
        dateText: date.toLocaleDateString(dateLocale, {
          month: 'long',
        }),
        yearText: String(date.getFullYear()),
      };
    }

    if (calendarView === 'day') {
      return {
        dateText: date.toLocaleDateString(dateLocale, {
          month: 'long',
          day: '2-digit',
        }),
        yearText: String(date.getFullYear()),
      };
    }

    const start = new Date(date);
    start.setDate(date.getDate() - date.getDay());

    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    const startMonth = start.toLocaleDateString(dateLocale, { month: 'long' });
    const endMonth = end.toLocaleDateString(dateLocale, { month: 'long' });
    const startYear = start.getFullYear();
    const endYear = end.getFullYear();

    if (startMonth !== endMonth && startYear !== endYear) {
      return {
        dateText: `${startMonth} / ${endMonth}`,
        yearText: `${startYear} / ${endYear}`,
      };
    }

    if (startMonth !== endMonth) {
      return {
        dateText: `${startMonth} - ${endMonth}`,
        yearText: String(endYear),
      };
    }

    return {
      dateText: startMonth,
      yearText: String(startYear),
    };
  };

  const navigateMainCalendar = (direction: 'previous' | 'next' | 'today') => {
    let nextDate = new Date(mainCalendarDate);

    if (direction === 'today') {
      nextDate = new Date();
    } else {
      const amount = direction === 'previous' ? -1 : 1;

      if (calendarView === 'month') {
        nextDate.setMonth(nextDate.getMonth() + amount);
      } else if (calendarView === 'day') {
        nextDate.setDate(nextDate.getDate() + amount);
      } else {
        nextDate.setDate(nextDate.getDate() + amount * 7);
      }
    }
  
    setMainCalendarDate(nextDate);
    setMiniCalendarDate(nextDate);
  };

  const calendarHeaderLabel = getCalendarHeaderLabel(mainCalendarDate);

  if (!authReady) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-primary-dark text-white">
        Loading…
      </main>
    );
  }

  return (
    <main className="h-screen flex flex-col bg-white">
      {/* Header with dropdowns */}
      <header>
        <div className="header-bar relative bg-primary-dark px-4 py-2.5 mx-3 sm:mx-4 xl:mx-6 mt-3 rounded-lg border dark:border-white/5">
          <div className="grid grid-cols-[145px_1fr_auto] lg:grid-cols-[145px_minmax(130px,1fr)_320px_minmax(190px,1fr)_auto] items-center gap-3 xl:gap-4">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <Link href="/" className="relative h-12 w-[150px]" title="Cadence home" aria-label="Cadence home">
                <Image
                  src="/cadence-logo-white.png"
                  alt="Cadence"
                  fill
                  priority
                  className="object-contain"
                />
              </Link>
            </div>

            {/* Calendar navigation */}
            <div className="hidden lg:flex justify-center">
              <div className="header-control-group flex items-center rounded-lg bg-white/10 border border-white/25 overflow-hidden">
                <button
                  type="button"
                  onClick={() => navigateMainCalendar('previous')}
                  className="h-10 px-3.5 flex items-center justify-center text-white text-base font-semibold hover:bg-white/15 transition-colors"
                  aria-label={m.nav.previous}
                >
                  <ChevronLeft size={16} strokeWidth={2.5} />
                </button>

                <button
                  type="button"
                  onClick={() => navigateMainCalendar('today')}
                  className="h-10 px-4 flex items-center justify-center gap-1.5 text-white text-base font-semibold hover:bg-white/15 transition-colors tracking-normal"
                >
                  {m.nav.today}
                </button>

                <button
                  type="button"
                  onClick={() => navigateMainCalendar('next')}
                  className="h-10 px-3.5 flex items-center justify-center text-white text-base font-semibold hover:bg-white/15 transition-colors"
                  aria-label={m.nav.next}
                >
                  <ChevronRight size={16} strokeWidth={2.5} />
                </button>
              </div>
            </div>

            {/* Date range */}
            <h1 className="flex w-full items-baseline justify-center text-center text-white whitespace-nowrap text-[40px] font-[500] tracking-tight leading-none">
              <span>{calendarHeaderLabel.dateText}</span>
              <span className="ml-4 opacity-90">{calendarHeaderLabel.yearText}</span>
            </h1>

            {/* View switcher */}
            <div className="hidden lg:flex justify-center">
              <div className="header-control-group flex items-center rounded-lg bg-white/10 border border-white/25 overflow-hidden">
                {(['month', 'week', 'day', 'agenda'] as View[]).map((viewName, index) => {
                  const shortLabel =
                    viewName === 'month'
                      ? 'M'
                      : viewName === 'week'
                        ? 'W'
                        : viewName === 'day'
                          ? 'D'
                          : null;
                  const viewLabel =
                    viewName === 'month'
                      ? m.nav.month
                      : viewName === 'week'
                        ? m.nav.week
                        : viewName === 'day'
                          ? m.nav.day
                          : m.nav.agenda;

                  const isActive = calendarView === viewName;
                  return (
                    <div key={viewName} className="flex items-center">
                      {index > 0 && (
                        <span className="h-5 w-px bg-white/20" />
                      )}

                <button
                  type="button"
                  onClick={() => setCalendarView(viewName)}
                  className="h-10 px-1.5 xl:px-2 flex items-center justify-center text-base font-medium transition-colors tracking-normal rounded-lg hover:bg-white/10"
                  aria-label={viewLabel}
                  title={viewLabel}
                >
                  <span
                    className={`h-8 min-w-8 xl:min-w-0 xl:px-3 flex items-center justify-center rounded-md transition-colors ${
                      isActive
                        ? 'bg-white text-primary shadow-sm'
                        : 'text-white'
                    }`}
                  >
                    <span className="xl:hidden">
                      {viewName === 'agenda' ? <List size={18} strokeWidth={2.4} /> : shortLabel}
                    </span>

                    <span className="hidden xl:inline">
                      {viewLabel}
                    </span>
                  </span>
                </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Mobile view dropdown hamburger */}
            <button
              onClick={() => {
                setMobileMenuOpen((prev) => !prev);
                setTasksDropdownOpen(false);
                setShowSubscriptionDialog(false);
              }}
              className="lg:hidden col-start-3 flex items-center justify-center p-2.5 rounded-lg bg-white/10 text-white border border-white/20 hover:bg-white/20 transition-colors"
              aria-label={m.nav.openMenu}
            >
              <Menu size={20} />
            </button>

            {/* Right actions */}
            <div className="hidden lg:flex items-center justify-end gap-4 relative">
              <input
                ref={fileInputRef}
                type="file"
                accept=".ics,text/calendar"
                onChange={handleImportICS}
                className="hidden"
                disabled={isImportingICS}
              />

              {/* Subscribe */}
              <div className="header-control-group flex items-center rounded-lg bg-white/10 border border-white/25 overflow-hidden shrink-0">
                <button
                  onClick={openSubscriptionDialog}
                  className={`h-9 px-2.5 xl:px-3 flex items-center justify-center gap-1.5 text-sm xl:text-base font-medium transition-colors ${
                    showSubscriptionDialog
                      ? 'bg-white/10 text-white'
                      : 'text-white hover:bg-white/15'
                  }`}
                  title={m.subscription.title}
                >
                  <LucideCalendarPlus size={20} />
                  <span className="hidden xl:inline">{m.nav.subscribe}</span>
                </button>
              </div>
              
              {/* Notifications Bell */}
              <div ref={notificationsRef} className="relative">
                <NotificationsBell
                  notifications={notifications}
                  open={notificationsOpen}
                  onToggle={() => setNotificationsOpen((v) => !v)}
                  onMarkRead={(id) => {
                    const now = new Date();
                    setNotifications((prev) =>
                      prev.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? now } : n))
                    );
                  }}
                  onMarkAllRead={() => {
                    const now = new Date();
                    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
                  }}
                  onClearAll={() => {
                    if (!confirm(m.notifications.confirmClear)) return;
                    storage.clearNotifications();
                    setNotifications([]);
                    setNotificationsOpen(false);
                  }}
                />
              </div>

              {/* Settings */}
              <div className="header-control-group flex items-center rounded-lg bg-white/10 border border-white/25 overflow-hidden">
                <button
                  onClick={() => {
                    setTempWorkHours(workHours);
                    setTempBreakAfterEvents(breakAfterEvents);
                    setTempFocusMinutes(focusMinutes);
                    setTempSkipDurationPrompt(skipDurationPrompt);
                    setShowSettingsDialog(true);
                  }}
                  className="h-9 w-9 flex items-center justify-center text-white hover:bg-white/15 transition-colors"
                  title={m.nav.settings}
                  aria-label={m.nav.settings}
                >
                  <Settings size={20} />
                </button>
              </div>

              {/* Subscription Dialog */}
              {showSubscriptionDialog && (
                <div className="subscription-dropdown absolute right-0 top-12 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50 p-4">
                  <h3 className="text-lg font-[700] text-primary mb-3">
                    {m.subscription.title}
                  </h3>

                  <div className="space-y-3">
                    {/* Google calendars (when connected) */}
                    {googleConnected && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-sm font-semibold text-primary">
                            {m.subscription.googleCalendars}
                          </h4>
                          <button
                            type="button"
                            onClick={() => void loadGoogleCalendarList()}
                            disabled={isLoadingGoogleCalendars}
                            className="text-xs px-2 py-1 text-primary-600 hover:bg-primary-50/10 rounded transition-colors disabled:opacity-50"
                          >
                            {isLoadingGoogleCalendars
                              ? m.subscription.refreshing
                              : m.subscription.refreshAll}
                          </button>
                        </div>
                        <p className="text-xs text-gray-500">
                          {m.subscription.googleCalendarsHelp}
                        </p>

                        {isLoadingGoogleCalendars && googleCalendarList.length === 0 ? (
                          <p className="text-xs text-gray-500">
                            {m.feed.googleManageCalendarsLoading}
                          </p>
                        ) : googleCalendarList.length === 0 ? (
                          <p className="text-xs text-gray-500">
                            {m.feed.googleManageCalendarsEmpty}
                          </p>
                        ) : (
                          <div className="space-y-2 max-h-56 overflow-y-auto overflow-x-visible pr-0.5">
                            {googleCalendarList.map((cal) => {
                              const enabled = selectedGoogleCalendarIds.includes(cal.id);
                              const color = resolveGoogleCalendarColor(cal);
                              const menuId = `google:${cal.id}`;
                              return (
                                <div
                                  key={cal.id}
                                  className="relative flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                                >
                                  <label className="min-w-0 flex items-center gap-2 cursor-pointer flex-1">
                                    <input
                                      type="checkbox"
                                      checked={enabled}
                                      onChange={() => toggleGoogleCalendarEnabled(cal.id)}
                                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                                    />
                                    <span
                                      className="h-4 w-4 flex-shrink-0 rounded-full border border-gray-300"
                                      style={{ backgroundColor: color }}
                                    />
                                    <div className="min-w-0">
                                      <p className="truncate text-sm font-medium text-gray-700">
                                        {cal.summary}
                                        {cal.primary ? (
                                          <span className="ml-1 text-[11px] text-gray-500">
                                            ({m.feed.googleManageCalendarsPrimary})
                                          </span>
                                        ) : null}
                                      </p>
                                    </div>
                                  </label>

                                  <div
                                    ref={
                                      openColorMenuId === menuId
                                        ? subscriptionColorMenuRef
                                        : undefined
                                    }
                                    className="flex items-center gap-1 ml-2 relative flex-shrink-0"
                                  >
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setOpenColorMenuId(
                                          openColorMenuId === menuId ? null : menuId
                                        )
                                      }
                                      className="px-2 py-1 text-xs text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-100 transition-colors flex items-center gap-1"
                                      title={m.subscription.pickColor}
                                    >
                                      <span
                                        className="w-3.5 h-3.5 rounded border border-gray-300"
                                        style={{ backgroundColor: color }}
                                      />
                                      {m.subscription.color}
                                    </button>

                                    {openColorMenuId === menuId && (
                                      <div className="absolute right-0 top-full mt-1 z-[999] bg-white border border-gray-200 rounded-lg shadow-lg p-2 min-w-[180px]">
                                        <p className="text-xs font-medium text-gray-600 mb-2">
                                          {m.subscription.pickColor}
                                        </p>
                                        <div className="grid grid-cols-6 gap-1 mb-2">
                                          {ICS_SUBSCRIPTION_COLORS.map((swatch) => (
                                            <button
                                              key={swatch}
                                              type="button"
                                              onClick={() =>
                                                handleSetGoogleCalendarColor(cal.id, swatch)
                                              }
                                              className={`w-6 h-6 rounded border-2 transition-colors ${
                                                color === swatch
                                                  ? 'border-primary'
                                                  : 'border-gray-200 hover:border-gray-400'
                                              }`}
                                              style={{ backgroundColor: swatch }}
                                              title={swatch}
                                            />
                                          ))}
                                        </div>
                                        <div className="flex items-center gap-2 border-t border-gray-100 pt-2">
                                          <input
                                            type="color"
                                            value={color.startsWith('#') ? color : '#4285f4'}
                                            onChange={(e) =>
                                              handleSetGoogleCalendarColor(
                                                cal.id,
                                                e.target.value
                                              )
                                            }
                                            className="w-8 h-8 cursor-pointer rounded border border-gray-300"
                                            title="Custom color"
                                          />
                                          <span className="text-xs text-gray-500">
                                            {m.subscription.custom}
                                          </span>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        <div className="flex items-center gap-3 pt-1">
                          <div className="h-px flex-1 bg-gray-200" />
                          <span className="text-xs text-gray-400">{m.subscription.orUrl}</span>
                          <div className="h-px flex-1 bg-gray-200" />
                        </div>
                      </div>
                    )}

                    {/* Import ICS File */}
                    <button
                      type="button"
                      onClick={() => {
                        triggerFileInput();
                      }}
                      disabled={isImportingICS}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-primary hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Upload size={16} />
                      {isImportingICS ? m.nav.importing : m.nav.importIcsFile}
                    </button>

                    {!googleConnected && (
                      <div className="flex items-center gap-3">
                        <div className="h-px flex-1 bg-gray-200" />
                        <span className="text-xs text-gray-400">{m.subscription.orUrl}</span>
                        <div className="h-px flex-1 bg-gray-200" />
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-primary mb-1">
                        {m.subscription.calendarUrl}
                      </label>
                      <input
                        type="url"
                        value={newSubscriptionUrl}
                        onChange={(e) => setNewSubscriptionUrl(e.target.value)}
                        placeholder={m.subscription.placeholderUrl}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        {m.subscription.hintUrl}
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-primary mb-1">
                        {m.subscription.calendarName}
                      </label>
                      <input
                        type="text"
                        value={newSubscriptionName}
                        onChange={(e) => setNewSubscriptionName(e.target.value)}
                        placeholder={m.subscription.placeholderName}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>

                    {/* Susbcribed Calendars */}
                    {icsSubscriptions.length > 0 && (
                      <div className="pt-3 mt-3 border-t border-gray-200">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <h4 className="text-sm font-semibold text-primary">
                            {m.subscription.subscribedCalendars}
                          </h4>

                          <button
                            type="button"
                            onClick={() => fetchAllICSSubscriptions()}
                            disabled={isLoadingICSSubscription}
                            className="text-xs px-2 py-1 text-primary-600 hover:bg-primary-50/10 rounded transition-colors disabled:opacity-50"
                          >
                            {isLoadingICSSubscription ? m.subscription.refreshing : m.subscription.refreshAll}
                          </button>
                        </div>

                        <div className="space-y-2 overflow-visible">
                          {icsSubscriptions.map((sub) => (
                            <div
                              key={sub.id}
                              className="relative flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                            >
                              <div className="min-w-0 flex items-center gap-2">
                                <span
                                  className="h-4 w-4 flex-shrink-0 rounded-full border border-gray-300"
                                  style={{ backgroundColor: sub.color || '#8b5cf6' }}
                                />

                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-gray-700">
                                    {sub.name}
                                  </p>
                                  <p className="truncate text-xs text-gray-500">
                                    {sub.url}
                                  </p>
                                </div>
                              </div>

                              <div
                                ref={openColorMenuId === sub.id ? subscriptionColorMenuRef : undefined}
                                className="flex items-center gap-1 ml-2 relative flex-shrink-0"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenColorMenuId(openColorMenuId === sub.id ? null : sub.id)
                                  }
                                  className="px-2 py-1 text-xs text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-100 transition-colors flex items-center gap-1"
                                  title={m.subscription.pickColor}
                                >
                                  <span
                                    className="w-3.5 h-3.5 rounded border border-gray-300"
                                    style={{ backgroundColor: sub.color || '#8b5cf6' }}
                                  />
                                  {m.subscription.color}
                                </button>

                                {openColorMenuId === sub.id && (
                                  <div className="absolute right-0 top-full mt-1 z-[999] bg-white border border-gray-200 rounded-lg shadow-lg p-2 min-w-[180px]">
                                    <p className="text-xs font-medium text-gray-600 mb-2">
                                      {m.subscription.pickColor}
                                    </p>

                                    <div className="grid grid-cols-6 gap-1 mb-2">
                                      {ICS_SUBSCRIPTION_COLORS.map((color) => (
                                        <button
                                          key={color}
                                          type="button"
                                          onClick={() => handleSetICSSubscriptionColor(sub.id, color)}
                                          className={`w-6 h-6 rounded border-2 transition-colors ${
                                            sub.color === color
                                              ? 'border-primary'
                                              : 'border-gray-200 hover:border-gray-400'
                                          }`}
                                          style={{ backgroundColor: color }}
                                          title={color}
                                        />
                                      ))}
                                    </div>

                                    <div className="flex items-center gap-2 border-t border-gray-100 pt-2">
                                      <input
                                        type="color"
                                        value={sub.color?.startsWith('#') ? sub.color : '#8b5cf6'}
                                        onChange={(e) =>
                                          handleSetICSSubscriptionColor(sub.id, e.target.value)
                                        }
                                        className="w-8 h-8 cursor-pointer rounded border border-gray-300"
                                        title="Custom color"
                                      />
                                      <span className="text-xs text-gray-500">{m.subscription.custom}</span>
                                    </div>
                                  </div>
                                )}

                                <button
                                  type="button"
                                  onClick={() => handleRemoveICSSubscription(sub.id)}
                                  className="p-1 text-red-400 hover:bg-red-50/20 rounded transition-colors"
                                  title="Remove subscription"
                                  aria-label="Remove subscription"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={handleAddICSSubscription}
                        disabled={isLoadingICSSubscription || !newSubscriptionUrl.trim()}
                        className="flex-1 px-4 py-2 bg-secondary text-white rounded-lg font-normal hover:bg-secondary/90 disabled:bg-secondary/85 disabled:cursor-not-allowed transition-colors"
                      >
                        {isLoadingICSSubscription ? m.subscription.adding : m.subscription.addSubscription}
                      </button>

                      <button
                        onClick={() => {
                          setShowSubscriptionDialog(false);
                          setNewSubscriptionUrl('');
                          setNewSubscriptionName('');
                        }}
                        className="cancel-btn px-4 py-2 text-primary font-normal rounded-lg border transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Mobile dropdown */}
          <div
            className={`absolute left-0 top-full w-full md:hidden z-50 origin-top transition-all duration-200 ease-out ${
              mobileMenuOpen
                ? 'opacity-100 translate-y-0 pointer-events-auto'
                : 'opacity-0 -translate-y-2 pointer-events-none'
            }`}
          >
            <div className="flex flex-col gap-2 bg-primary-dark border border-white/20 border-t-0 rounded-b-lg p-3 shadow-xl">
              <button
                onClick={() => {
                  triggerFileInput();
                  setMobileMenuOpen(false);
                }}
                disabled={isImportingICS}
                className="mobile-menu-btn import-btn w-full flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-white/10 text-white border border-white/25"
              >
                <Upload size={18} />
                {isImportingICS ? m.nav.importing : m.nav.importIcs}
              </button>

              <button
                onClick={() => {
                  setShowSubscriptionDialog(true);
                  if (googleConnected) void loadGoogleCalendarList();
                  setTasksDropdownOpen(false);
                  setMobileMenuOpen(false);
                }}
                className="mobile-menu-btn subscribe-btn w-full flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-white/10 text-white border border-white/25"
              >
                <Link2 size={18} />
                {m.nav.subscribe}
              </button>

              <button
                onClick={() => {
                  setTasksDropdownOpen(true);
                  setShowSubscriptionDialog(false);
                  setMobileMenuOpen(false);
                }}
                className="mobile-menu-btn task-dropdown-btn w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-primary-light text-white border border-white/25"
              >
                <span className="flex items-center gap-2">
                  <Menu size={18} />
                  {m.tasks.title}
                </span>
                {incompleteTasksCount > 0 && (
                  <span className="bg-white/90 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">
                    {incompleteTasksCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => {
                  setTempWorkHours(workHours);
                  setTempBreakAfterEvents(breakAfterEvents);
                  setTempFocusMinutes(focusMinutes);
                  setTempSkipDurationPrompt(skipDurationPrompt);
                  setShowSettingsDialog(true);
                  setMobileMenuOpen(false);
                }}
                className="mobile-menu-btn settings-btn w-full flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-white/10 text-white border border-white/25"
              >
                <Settings size={18} />
                {m.nav.settings}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Full-Width Calendar with Task Sidebar */}
      <div className="mobile-view-scroll flex-1 min-h-0 overflow-y-auto xl:overflow-hidden">
        <div className="min-h-full xl:h-full w-full px-3 sm:px-4 xl:px-6 py-3 xl:py-4">          
          <div className="h-full w-full grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_clamp(270px,19vw,320px)] gap-3 xl:gap-4 min-w-0">         
            <div className="h-[75vh] xl:h-full xl:max-h-none overflow-hidden">
              <Calendar
                events={allEvents}
                date={mainCalendarDate}
                view={calendarView}
                workHours={workHours}
                onViewChange={setCalendarView}
                onDateChange={(date) => {
                  setMainCalendarDate(date);
                  setMiniCalendarDate(date);
                }}
                onSelectSlot={handleSelectSlot}
                onSelectEvent={handleSelectEvent}
              />
            </div>

            {/* Task Sidebar */}
            <aside className="h-auto xl:h-full min-h-0 grid grid-cols-1 lg:grid-cols-2 xl:flex xl:flex-col gap-4 items-stretch">

              {/* Tasks */}
              <div className="bg-background rounded-lg shadow-lg border border-gray-200 p-4 flex flex-col min-h-[520px] md:min-h-[600px] xl:min-h-0 xl:flex-1">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-semibold text-primary">{m.tasks.title}</h2>
                  <button
                    onClick={() => {
                      setTaskDurationMode('preset');
                      setShowAddTaskDialog(true);
                      setIsAddingTask(false);
                    }}
                    className="h-8 w-8 rounded-lg bg-primary-light text-white flex items-center justify-center hover:bg-primary-light/90"
                  >
                    <Plus size={18}  />
                  </button>
                </div>

                <div className="mb-3 grid grid-cols-2 rounded-xl bg-white/70 p-1 shadow-sm ring-1 ring-gray-200 dark:bg-white/5 dark:ring-white/10">
                  <button
                    type="button"
                    onClick={() => setTaskSidebarTab('active')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      taskSidebarTab === 'active'
                        ? 'bg-primary-light text-white shadow-sm dark:bg-primary-light dark:text-white'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/80'
                    }`}
                  >
                    {m.tasks.activeTab} ({activeTasks.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => setTaskSidebarTab('completed')}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      taskSidebarTab === 'completed'
                        ? 'bg-primary-light text-white shadow-sm dark:bg-primary-light dark:text-white'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/80'
                    }`}
                  >
                    {m.tasks.completedTab} ({completedTasks.length})
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                  {displayedTasks.length === 0 ? (
                    <p className="text-gray-600 text-center py-6 text-sm">
                      {t('tasks.noTasks', {
                        status:
                          taskSidebarTab === 'active' ? m.tasks.active : m.tasks.completed,
                      })}
                    </p>
                  ) : (
                    displayedTasks.map((task) => (
                      <div
                        key={task.id}
                        onClick={() =>
                          setExpandedTaskId(expandedTaskId === task.id ? null : task.id)
                        }
                        className="task-card rounded-xl border border-gray-200 bg-white px-3.5 py-3 shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow-md flex flex-col cursor-pointer"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <h3
                            className={`min-w-0 flex-1 text-sm font-semibold text-gray-900 ${
                              expandedTaskId === task.id
                                ? 'whitespace-normal break-words'
                                : 'truncate'
                            }`}
                          >
                            {task.title}
                          </h3>

                          <div className="flex shrink-0 items-center gap-2">
                            {(() => {
                              const priorityStyle = getPriorityColor(task.priority);

                              return (
                                <span
                                  className={`inline-flex items-center gap-1.5 text-xs font-semibold capitalize ${priorityStyle.text}`}
                                >
                                  <span className={`h-1.5 w-1.5 rounded-full ${priorityStyle.dot}`} />
                                  {m.priority[task.priority]}
                                </span>
                              );
                            })()}

                            <ChevronDown
                              size={14}
                              className={`text-gray-400 transition-transform duration-200 ${
                                expandedTaskId === task.id ? 'rotate-180' : ''
                              }`}
                            />
                          </div>
                        </div>

                        {task.description && (
                          <div
                            className={`mt-1.5 w-full overflow-hidden transition-[max-height] duration-300 ease-in-out ${
                              expandedTaskId === task.id ? 'max-h-40' : 'max-h-4'
                            }`}
                          >
                            <p className="text-xs leading-4 text-gray-500 whitespace-pre-line">
                              {htmlToReadableText(task.description)}
                            </p>
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-500">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                            <div className="flex items-center gap-1 font-medium text-primary">
                              <Clock size={12} />
                              <span>
                                {m.tasks.avg} {formatMinutesToHoursMinutes(getAverageDuration(task))}
                              </span>
                            </div>

                            {task.actualDurations.length > 0 && (
                              <span className="text-gray-400">
                                {t('tasks.completedCount', { count: task.actualDurations.length })}
                              </span>
                            )}

                            {task.dueDate && (
                              <span className="font-medium text-orange-600">
                                {m.tasks.due} {new Date(task.dueDate).toLocaleDateString(dateLocale)}
                              </span>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            {!task.completedAt && (
                              <button
                                onClick={() => requestCompleteTask(task.id)}
                                className="rounded-md p-1.5 text-green-600 transition-colors hover:bg-green-50 hover:text-green-700"
                              >
                                <CheckCircle2 size={14} />
                              </button>
                            )}

                            <button
                              onClick={() => handleDeleteTask(task.id)}
                              className="rounded-md p-1.5 text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              
              {/* Mini Calendar */}
              <div className="bg-background rounded-lg shadow-lg border border-gray-200 p-5 xl:p-4 min-h-[520px] md:min-h-[600px] xl:min-h-0 flex flex-col">                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl md:text-xl xl:text-md font-semibold text-primary">
                    {miniCalendarMonthLabel}
                  </h3>
                  
                  <div className="flex items-center gap-2 text-gray-500 text-xs">
                    <button
                      type="button"
                      onClick={goToPreviousMiniMonth}
                      className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-gray-200 text-lg"
                    >
                      ‹
                    </button>

                    <button
                      type="button"
                      onClick={goToNextMiniMonth}
                      className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-gray-200 text-lg"
                    >
                      ›
                    </button>
                  </div>
                </div>
                
                {/* Days of the week*/}
                <div className="grid grid-cols-7 gap-3 md:gap-4 xl:gap-2 text-center text-sm md:text-base xl:text-[11px] font-medium text-gray-400 mb-4 xl:mb-3">
                  {m.calendar.weekdaysShort.map((d) => (
                    <div key={d}>{d}</div>
                  ))}
                </div>

                {/* Mini calendar days grid */}
                <div className="grid flex-1 grid-cols-7 grid-rows-6 gap-2 text-center text-sm md:text-md xl:text-[11px] text-gray-600">
                  {miniCalendarDays.map((day, index) => (
                    <button
                      key={index}
                      type="button"
                      disabled={!day}
                      onClick={() => {
                        if (!day) return;
                          const selectedDate = new Date(miniCalendarYear, miniCalendarMonth, day);
                          setMainCalendarDate(selectedDate);
                          setMiniCalendarDate(selectedDate);
                      }}
                      className={`h-full aspect-square max-h-10 md:max-h-12 xl:max-h-6 w-full max-w-10 md:max-w-12 xl:max-w-6 mx-auto flex items-center justify-center rounded-full text-sm md:text-base xl:text-[11px] transition-colors ${

                        // Highlight selected date
                        day && mainCalendarDate.getFullYear() === miniCalendarYear &&
                        mainCalendarDate.getMonth() === miniCalendarMonth &&
                        mainCalendarDate.getDate() === day
                          ? 'bg-primary-light text-white font-semibold'

                          // Highlight today's date
                          : day && isCurrentMiniCalendarMonth && day === today.getDate()
                            ? 'border border-primary-light text-primary font-semibold'
                            : day ? 'hover:bg-gray-200 dark:hover:bg-white/10 dark:hover:text-white' : ''
                      }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>

      {/* Add Task Dialog (from calendar) */}
      {showAddTaskDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-4 border border-gray-200">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-xl font-bold text-primary">{m.addTask.title}</h3>
              </div>
              <button
                onClick={() => setShowAddTaskDialog(false)}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title={m.common.close}
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newTask.title.trim() && !isDecomposingNewTask) {
                  void handleAddTask(newTask);
                }
              }}
              className="space-y-4"
            >
              <div className="space-y-3">
                <input
                  type="text"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder={m.addTask.taskTitle}
                  required
                  autoFocus
                  disabled={isDecomposingNewTask}
                />
                <div>
                  <textarea
                    value={newTask.description}
                    onChange={(e) => {
                      const description = e.target.value;
                      setNewTask({ ...newTask, description });
                      if (description.trim() && !breakDownNewTaskWithAi) {
                        setBreakDownNewTaskWithAi(true);
                      }
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    placeholder={m.addTask.description}
                    rows={3}
                    disabled={isDecomposingNewTask}
                  />
                  <p className="mt-1 text-[11px] text-gray-500">{m.addTask.descriptionHint}</p>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2">
                  <div>
                    <p className="text-sm font-medium text-gray-700">{m.addTask.breakDownAi}</p>
                    <p className="text-xs text-gray-500">{m.addTask.breakDownAiHint}</p>
                  </div>
                  <button
                    type="button"
                    disabled={isDecomposingNewTask || !newTask.description?.trim()}
                    onClick={() => setBreakDownNewTaskWithAi((prev) => !prev)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                      breakDownNewTaskWithAi && newTask.description?.trim()
                        ? 'bg-primary-light'
                        : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        breakDownNewTaskWithAi && newTask.description?.trim()
                          ? 'translate-x-6'
                          : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Estimated Duration
                  </label>
                  <div className="space-y-2">
                      <select
                        value={
                          taskDurationMode === 'preset'
                            ? String(newTask.estimatedDuration || 60)
                            : 'custom'
                        }
                        onChange={(e) => {
                          const value = e.target.value;
                          if (value === 'custom') {
                            setTaskDurationMode('custom');
                            setNewTask((prev) => ({
                              ...prev,
                              estimatedDuration: Math.max(
                                15,
                                Math.round(taskDurationCustomHours * 60)
                              ),
                            }));
                            return;
                          }
                          setTaskDurationMode('preset');
                          const minutes = parseInt(value, 10) || 60;
                          setNewTask({ ...newTask, estimatedDuration: minutes });
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:opacity-60"
                        disabled={
                          isDecomposingNewTask ||
                          (breakDownNewTaskWithAi && Boolean(newTask.description?.trim()))
                        }
                      >
                        {[30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600].map((mins) => (
                          <option key={mins} value={mins}>
                            {formatMinutesToHoursMinutes(mins)}
                          </option>
                        ))}
                        <option value="custom">Custom (hours)</option>
                      </select>
                      {taskDurationMode === 'custom' &&
                        !(breakDownNewTaskWithAi && newTask.description?.trim()) && (
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={0.5}
                            step={0.5}
                            value={taskDurationCustomHours}
                            onChange={(e) => {
                              const hours = parseFloat(e.target.value) || 0;
                              setTaskDurationCustomHours(hours);
                              const minutes = Math.max(0, Math.round(hours * 60));
                              setNewTask({ ...newTask, estimatedDuration: minutes });
                            }}
                            className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                            placeholder="Hours"
                          />
                          <span className="text-xs text-gray-600">hours</span>
                        </div>
                      )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Due Date (Optional)
                    </label>
                    <input
                      type="date"
                      value={newTask.dueDate || ''}
                      onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value || undefined })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      min={formatDateToLocalISO(new Date())}
                      disabled={isDecomposingNewTask}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
                    <select
                      value={newTask.priority}
                      onChange={(e) =>
                        setNewTask({ ...newTask, priority: e.target.value as 'low' | 'medium' | 'high' })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      disabled={isDecomposingNewTask}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-gray-700">{m.addTask.scheduleAuto}</p>
                  <p className="text-xs text-gray-500">{m.addTask.scheduleAutoHint}</p>
                </div>
                
                <button
                  type="button"
                  disabled={isDecomposingNewTask}
                  onClick={() => setAutoScheduleNewTask(prev => !prev)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                    autoScheduleNewTask ? 'bg-primary-light' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      autoScheduleNewTask ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={isDecomposingNewTask || !newTask.title.trim()}
                  className="flex-1 px-4 py-2 bg-secondary text-white rounded-lg hover:bg-secondary/90 transition-colors disabled:opacity-60"
                >
                  {isDecomposingNewTask ? m.addTask.breakingDown : m.addTask.addTaskBtn}
                </button>
                <button
                  type="button"
                  disabled={isDecomposingNewTask}
                  onClick={() => setShowAddTaskDialog(false)}
                  className="cancel-btn px-4 py-2 text-primary rounded-lg border transition-colors disabled:opacity-60"
                >
                  {m.common.cancel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Event Dialog - Convert to Task or Delete */}
      {showEventDialog && selectedEvent && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4 my-8 max-h-[85vh] overflow-y-auto">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Convert Event to Task</h3>
            <div className="mb-4 space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Event:</p>
                <p className="text-lg text-gray-900">{selectedEvent.title}</p>
                {selectedEvent.description && (
                  <ReadableDescription html={selectedEvent.description} />
                )}
                <div className="mt-2 text-xs text-gray-500">
                  <p>Date: {selectedEvent.start.toLocaleDateString()}</p>
                  <p>Time: {selectedEvent.start.toLocaleTimeString()} - {selectedEvent.end.toLocaleTimeString()}</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Task Duration
                </label>
                <div className="space-y-2">
                    <select
                      value={
                        conversionDurationMode === 'preset' &&
                        [30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600].includes(
                          conversionDuration
                        )
                          ? String(conversionDuration)
                          : 'custom'
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === 'custom') {
                          setConversionDurationMode('custom');
                          setConversionDuration(
                            Math.max(15, Math.round(conversionDurationCustomHours * 60))
                          );
                          return;
                        }
                        setConversionDurationMode('preset');
                        const minutes = parseInt(value, 10) || 60;
                        setConversionDuration(minutes);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      {[30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600].map((mins) => (
                        <option key={mins} value={mins}>
                          {formatMinutesToHoursMinutes(mins)}
                        </option>
                      ))}
                      <option value="custom">Custom (hours)</option>
                    </select>
                    {conversionDurationMode === 'custom' && (
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={0.5}
                          step={0.5}
                          value={conversionDurationCustomHours}
                          onChange={(e) => {
                            const hours = parseFloat(e.target.value) || 0;
                            setConversionDurationCustomHours(hours);
                            const minutes = Math.max(0, Math.round(hours * 60));
                            setConversionDuration(minutes);
                          }}
                          className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                          placeholder="Hours"
                        />
                        <span className="text-xs text-gray-600">hours</span>
                      </div>
                    )}
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  How long will this task take to complete?
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handleBreakDownWithAI(selectedEvent)}
                disabled={isDecomposingEvent}
                className="breakdown-btn w-full flex items-center justify-center gap-2 px-4 py-2.5 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isDecomposingEvent ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    Breaking down with AI…
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    Break down with AI
                  </>
                )}
              </button>
              <p className="text-xs text-gray-500 text-center">
                Reads the event description and creates multiple subtasks with steps, then schedules them.
              </p>
            </div>
            <div className="flex gap-3 mt-3">
              <button
                onClick={() => handleConvertEventToTask(selectedEvent)}
                className="convert-task-btn flex-1 flex items-center justify-center gap-2 px-4 py-2 text-white rounded-lg transition-colors"
              >
                <CheckSquare size={18} />
                Convert to Task
              </button>
              <button
                onClick={() => handleDeleteEvent(selectedEvent)}
                className="delete-btn px-4 py-2 text-white rounded-lg transition-colors"
              >
                <Trash2 size={18} />
              </button>
              <button
                onClick={() => {
                  setShowEventDialog(false);
                  setSelectedEvent(null);
                  setConversionDuration(60);
                }}
                className="cancel-btn px-4 py-2 text-primary rounded-lg border transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Work Hours Settings Dialog (standalone - kept for any direct links) */}
      {showGoogleCalendarsDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4 max-h-[80vh] flex flex-col">
            <h3 className="text-xl font-bold text-gray-800 mb-2">
              {m.feed.googleManageCalendarsTitle}
            </h3>
            <p className="text-sm text-gray-600 mb-4">{m.feed.googleManageCalendarsHelp}</p>

            <div className="flex-1 overflow-y-auto space-y-2 mb-4">
              {isLoadingGoogleCalendars ? (
                <p className="text-sm text-gray-500">{m.feed.googleManageCalendarsLoading}</p>
              ) : googleCalendarList.length === 0 ? (
                <p className="text-sm text-gray-500">{m.feed.googleManageCalendarsEmpty}</p>
              ) : (
                googleCalendarList.map((cal) => {
                  const checked = selectedGoogleCalendarIds.includes(cal.id);
                  return (
                    <label
                      key={cal.id}
                      className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleGoogleCalendarSelection(cal.id)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                      <span
                        className="inline-block w-3 h-3 rounded-full shrink-0"
                        style={{
                          backgroundColor: resolveGoogleCalendarColor(cal),
                        }}
                      />
                      <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">
                        {cal.summary}
                        {cal.primary ? (
                          <span className="ml-1 text-[11px] text-gray-500">
                            ({m.feed.googleManageCalendarsPrimary})
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowGoogleCalendarsDialog(false)}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
              >
                {m.feed.googleManageCalendarsCancel}
              </button>
              <button
                type="button"
                disabled={isLoadingGoogleCalendars || selectedGoogleCalendarIds.length === 0}
                onClick={saveGoogleCalendarSelection}
                className="px-3 py-1.5 text-sm font-medium rounded-lg bg-primary text-white hover:opacity-90 disabled:opacity-60"
              >
                {m.feed.googleManageCalendarsSave}
              </button>
            </div>
          </div>
        </div>
      )}


      {showWorkHoursDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4 ">
            <h3 className="text-xl font-bold text-gray-800 mb-4">Set Work Hours</h3>
            <p className="text-sm text-gray-600 mb-4">
              Tasks will only be created and scheduled during these hours (Monday–Friday). You can define multiple work
              blocks per day (for example 6–9 AM and 6–9 PM).
            </p>
            <div className="space-y-4">
              {tempWorkHours.segments.map((segment, index) => (
                <div key={index} className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Start Hour
                    </label>
                    <select
                      value={segment.startHour}
                      onChange={(e) => {
                        const value = parseInt(e.target.value);
                        setTempWorkHours({
                          segments: tempWorkHours.segments.map((s, i) =>
                            i === index ? { ...s, startHour: value } : s
                          ),
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      {Array.from({ length: 24 }, (_, i) => i).map((hour) => {
                        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                        const ampm = hour < 12 ? 'AM' : 'PM';
                        return (
                          <option key={hour} value={hour}>
                            {displayHour}:00 {ampm}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      End Hour
                    </label>
                    <select
                      value={segment.endHour}
                      onChange={(e) => {
                        const value = parseInt(e.target.value);
                        setTempWorkHours({
                          segments: tempWorkHours.segments.map((s, i) =>
                            i === index ? { ...s, endHour: value } : s
                          ),
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    >
                      {Array.from({ length: 24 }, (_, i) => i).map((hour) => {
                        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                        const ampm = hour < 12 ? 'AM' : 'PM';
                        return (
                          <option key={hour} value={hour}>
                            {displayHour}:00 {ampm}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  {tempWorkHours.segments.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setTempWorkHours({
                          segments: tempWorkHours.segments.filter((_, i) => i !== index),
                        });
                      }}
                      className="px-3 py-2 text-sm text-red-600 hover:text-red-700"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={() => {
                  const fallbackSegment = { startHour: 9, endHour: 18 };
                  setTempWorkHours({
                    segments: [
                      ...tempWorkHours.segments,
                      fallbackSegment,
                    ],
                  });
                }}
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                + Add work segment
              </button>

              {!isTempWorkHoursValid && (
                <p className="text-sm text-red-600">
                  Each segment must have an end hour after its start hour, and at least one segment is required.
                </p>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  if (isTempWorkHoursValid) {
                    setWorkHours(tempWorkHours);
                    storage.saveWorkHours(tempWorkHours);
                    setShowWorkHoursDialog(false);
                  }
                }}
                disabled={!isTempWorkHoursValid}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setShowWorkHoursDialog(false);
                  setTempWorkHours(workHours);
                }}
                className="cancel-btn px-4 py-2 text-primary rounded-lg border transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Dialog */}
      {completingTaskId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70]">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold text-gray-800 mb-1">{m.tasks.completeTaskTitle}</h3>
            <p className="text-sm text-gray-500 mb-4">{m.tasks.completeTaskHint}</p>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {m.tasks.promptActualMinutes}
            </label>
            {(() => {
              const task = tasks.find((t) => t.id === completingTaskId);
              const suggested = getSuggestedCompletionMinutes(completingTaskId);
              const isAi = Boolean(task?.planId || task?.planStepOrder !== undefined);
              return (
                <p className="text-xs text-primary-700 mb-2">
                  {isAi
                    ? t('tasks.aiSuggestedMinutes', { minutes: suggested })
                    : t('tasks.suggestedMinutes', { minutes: suggested })}
                </p>
              );
            })()}
            <input
              type="number"
              min={1}
              max={24 * 60}
              value={completionDurationInput}
              onChange={(e) => setCompletionDurationInput(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 mb-3"
              autoFocus
            />
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={completionDontAskAgain}
                onChange={(e) => setCompletionDontAskAgain(e.target.checked)}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              {m.tasks.dontAskDurationAgain}
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={submitCompletionWithReport}
                className="flex-1 px-3 py-2 bg-secondary text-white rounded-lg text-sm font-medium hover:bg-secondary/90"
              >
                {m.tasks.completeTaskSubmit}
              </button>
              <button
                type="button"
                onClick={skipCompletionQuestionnaire}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                {m.tasks.completeTaskSkip}
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setCompletingTaskId(null);
                setCompletionDurationInput('');
                setCompletionDontAskAgain(false);
              }}
              className="mt-3 w-full text-xs text-gray-500 underline hover:no-underline"
            >
              {m.common.cancel}
            </button>
          </div>
        </div>
      )}

      {showSettingsDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto border border-gray-200">
            <h3 className="text-xl font-bold text-primary mb-1">{m.settings.title}</h3>
            <p className="text-sm text-gray-600 mb-6">{m.settings.subtitle}</p>
            
            <div className="space-y-6">
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2">{m.common.languageLabel}</h4>
                <select
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as AppLocale)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                >
                  <option value="en">{m.common.english}</option>
                  <option value="ko">{m.common.korean}</option>
                </select>
              </div>

              {userProfile && (
                <p className="text-xs text-gray-500">
                  {t('settings.localProfile', { username: userProfile.username })}
                </p>
              )}

              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <Link2 size={16} />
                  {m.settings.feedSection.title}
                </h4>
                <p className="text-xs text-gray-500 mb-2">
                  {m.settings.feedSection.paragraph1}{' '}
                  <strong>{m.settings.feedSection.paragraph2}</strong>
                </p>
                {devUsesPublicCadenceFeed && publicFeedDeployed === false && (
                  <div className="mb-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-950">
                    <strong>Google Calendar can&apos;t load your feed yet.</strong> The live site at{' '}
                    www.bridgerscadence.com does not have the calendar-feed API deployed (we checked).
                    Deploy the latest Cadence build to Vercel, connect <strong>Vercel Blob</strong> storage,
                    then click <strong>Sync now</strong> and re-subscribe in Google Calendar.
                  </div>
                )}
                {devUsesPublicCadenceFeed && calendarFeedSyncDiffersFromSubscription() && (
                  <div className="mb-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
                    Sync saves to <strong>localhost</strong>; your subscription link uses{' '}
                    <strong>www.bridgerscadence.com</strong>. Use the live site (or configure Blob on
                    Vercel) so Google Calendar sees the same data.
                  </div>
                )}
                <div className="space-y-1.5 mb-3">
                  <p className="text-[11px] font-semibold text-gray-700">{m.feed.googleConnectedTitle}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={googleSyncing}
                      onClick={() =>
                        googleConnected
                          ? void pushGoogleCalendar(events, true)
                          : void handleConnectGoogle()
                      }
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-60"
                    >
                      <CalendarIcon size={13} />
                      {googleSyncing
                        ? m.feed.googleSyncing
                        : googleConnected
                          ? m.feed.googleSync
                          : m.feed.googleConnect}
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-500">
                    {googleConnected ? m.feed.googlePushHelp : m.feed.googleConnectHelp}
                  </p>
                  {googleConnected && (
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void openGoogleCalendarsDialog()}
                        className="text-[11px] text-primary-700 underline hover:no-underline"
                      >
                        {m.feed.googleManageCalendars}
                      </button>
                      <button
                        type="button"
                        onClick={handleReconnectGoogle}
                        className="text-[11px] text-primary-700 underline hover:no-underline"
                      >
                        {m.feed.googleReconnectAction}
                      </button>
                      <button
                        type="button"
                        onClick={handleDisconnectGoogle}
                        className="text-[11px] text-gray-500 underline hover:no-underline"
                      >
                        {m.feed.googleDisconnect}
                      </button>
                    </div>
                  )}
                  {googlePushError && (
                    <p className="text-[11px] text-red-600">
                      {googlePushError}{' '}
                      <button
                        type="button"
                        onClick={handleReconnectGoogle}
                        className="underline hover:no-underline"
                      >
                        {m.feed.googleReconnectAction}
                      </button>
                    </p>
                  )}
                </div>
                {calendarFeedUrl ? (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-700">
                      {m.feed.onFeed}{' '}
                      <strong>
                        {feedSyncedEventCount ?? feedPublishPreviewCount}{' '}
                        {(feedSyncedEventCount ?? feedPublishPreviewCount) === 1
                          ? m.feed.event
                          : m.feed.events}
                      </strong>
                      {feedPublishPreviewCount === 0 && (
                        <span className="text-amber-800"> {m.feed.addTaskHint}</span>
                      )}
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={calendarFeedUrl}
                        className="flex-1 min-w-0 px-2 py-1.5 border border-gray-300 rounded text-xs text-gray-700 bg-gray-50"
                      />
                      <button
                        type="button"
                        onClick={() => void copyCalendarFeedLink()}
                        className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
                      >
                        {feedLinkCopied ? m.common.copied : m.common.copy}
                      </button>
                    </div>
                    <p className="text-[11px] text-gray-500">{m.feed.subscribeTitle}</p>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={buildWebcalFeedUrl(calendarFeedUrl)}
                        className="inline-block px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
                      >
                        {m.feed.appleAdd}
                      </a>
                      <a
                        href={buildOutlookCalendarSubscribeUrl(calendarFeedUrl)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-block px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 hover:bg-gray-50"
                      >
                        {m.feed.outlookAdd}
                      </a>
                    </div>
                    {feedSyncError && (
                      <p className="text-xs text-red-600">{feedSyncError}</p>
                    )}
                    {feedSyncError?.includes('not configured on Vercel') && (
                      <p className="text-xs text-gray-600 mt-1">
                        In Vercel: Project → Storage → create <strong>Blob</strong> (or Upstash Redis),
                        redeploy, then try Sync again.
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3 items-center">
                      <button
                        type="button"
                        disabled={feedSyncing}
                        onClick={() => void manualSyncCalendarFeed()}
                        className="text-xs font-medium text-primary-700 underline hover:no-underline disabled:opacity-60"
                      >
                        {feedSyncing ? m.settings.syncing : m.settings.syncNow}
                      </button>
                      {calendarFeedUrl && (
                        <a
                          href={calendarFeedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-gray-700 underline hover:no-underline"
                        >
                          {m.settings.previewFeed}
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void rotateCalendarFeedLink()}
                        className="text-xs text-gray-600 underline hover:no-underline"
                      >
                        {m.settings.generateNewLink}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">{m.settings.loadingFeedLink}</p>
                )}
              </div>

              {/* Working Hours */}
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <Clock size={16} />
                  {m.settings.workingHours}
                </h4>
                <p className="text-xs text-gray-500 mb-2">{m.settings.workingHoursHint}</p>
                <div className="space-y-3">
                  {tempWorkHours.segments.map((segment, index) => (
                    <div key={index} className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">{m.settings.start}</label>
                        <select
                          value={segment.startHour}
                          onChange={(e) => {
                            const value = parseInt(e.target.value);
                            setTempWorkHours({
                              segments: tempWorkHours.segments.map((s, i) =>
                                i === index ? { ...s, startHour: value } : s
                              ),
                            });
                          }}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        >
                          {Array.from({ length: 24 }, (_, i) => i).map((hour) => {
                            const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                            const ampm = hour < 12 ? 'AM' : 'PM';
                            return (
                              <option key={hour} value={hour}>
                                {displayHour}:00 {ampm}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">{m.settings.end}</label>
                        <select
                          value={segment.endHour}
                          onChange={(e) => {
                            const value = parseInt(e.target.value);
                            setTempWorkHours({
                              segments: tempWorkHours.segments.map((s, i) =>
                                i === index ? { ...s, endHour: value } : s
                              ),
                            });
                          }}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                        >
                          {Array.from({ length: 24 }, (_, i) => i).map((hour) => {
                            const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                            const ampm = hour < 12 ? 'AM' : 'PM';
                            return (
                              <option key={hour} value={hour}>
                                {displayHour}:00 {ampm}
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      {tempWorkHours.segments.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setTempWorkHours({
                              segments: tempWorkHours.segments.filter((_, i) => i !== index),
                            });
                          }}
                          className="px-2 py-1 text-xs text-red-600 hover:text-red-700"
                        >
                          {m.settings.remove}
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      const fallbackSegment = { startHour: 9, endHour: 18 };
                      setTempWorkHours({
                        segments: [
                          ...tempWorkHours.segments,
                          fallbackSegment,
                        ],
                      });
                    }}
                    className="text-xs text-primary-600 hover:text-primary-700"
                  >
                    {m.settings.addWorkSegment}
                  </button>
                </div>
                {!isTempWorkHoursValid && (
                  <p className="text-xs text-red-600 mt-1">
                    {m.settings.workHoursInvalid}
                  </p>
                )}
              </div>

              {/* Break after events */}
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2">{m.settings.breakAfter}</h4>
                <p className="text-xs text-gray-500 mb-2">{m.settings.breakAfterHint}</p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={tempBreakAfterEvents}
                    onChange={(e) => setTempBreakAfterEvents(Math.max(0, parseInt(e.target.value) || 0))}
                    min={0}
                    max={120}
                    className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-600">{m.common.minutes}</span>
                </div>
              </div>

              {/* Focus hours */}
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2">{m.settings.focusDuration}</h4>
                <p className="text-xs text-gray-500 mb-2">{m.settings.focusDurationHint}</p>
                <select
                  value={tempFocusMinutes}
                  onChange={(e) => setTempFocusMinutes(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                >
                  {[30, 45, 50, 60, 75, 90, 120, 150, 180].map((mins) => (
                    <option key={mins} value={mins}>
                      {mins < 60 ? `${mins} minutes` : mins === 60 ? '1 hour' : `${mins / 60} hours`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Skip duration prompt */}
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2">
                  {m.settings.skipDurationPrompt}
                </h4>
                <p className="text-xs text-gray-500 mb-2">{m.settings.skipDurationPromptHint}</p>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={tempSkipDurationPrompt}
                    onChange={(e) => setTempSkipDurationPrompt(e.target.checked)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  {m.settings.skipDurationPrompt}
                </label>
              </div>

              {/* Tutorial */}
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2">{m.settings.tutorial}</h4>
                <p className="text-xs text-gray-500 mb-2">{m.settings.tutorialHint}</p>
                <button
                  type="button"
                  onClick={() => {
                    setShowSettingsDialog(false);
                    startTutorial();
                  }}
                  className="replay-btn w-full px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
                >
                  {m.settings.replayTutorial}
                </button>
              </div>

              {/* Appearance */}
            <div>
              <h4 className="text-sm font-semibold text-gray-800 mb-2">{m.settings.appearance}</h4>
              <p className="text-xs text-gray-500 mb-2">
                {locale === 'ko' ? '라이트/다크 모드 전환' : 'Toggle between light and dark mode'}
              </p>

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">
                  {darkMode ? m.settings.darkMode : m.settings.lightMode}
                </span>

                <button
                  type="button"
                  onClick={() => setDarkMode(!darkMode)}
                  className={`theme-toggle relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    darkMode ? 'active' : ''
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      darkMode ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            </div>

            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200">
              <button
                onClick={() => {
                  if (isTempWorkHoursValid) {
                    setWorkHours(tempWorkHours);
                    storage.saveWorkHours(tempWorkHours);
                  }
                  setBreakAfterEvents(tempBreakAfterEvents);
                  storage.saveBreakAfterEvents(tempBreakAfterEvents);
                  setFocusMinutes(tempFocusMinutes);
                  storage.saveFocusMinutes(tempFocusMinutes);
                  setSkipDurationPrompt(tempSkipDurationPrompt);
                  storage.saveSkipDurationPrompt(tempSkipDurationPrompt);
                  setShowSettingsDialog(false);
                }}
                disabled={!isTempWorkHoursValid}
                className="flex-1 px-4 py-2 bg-secondary text-white rounded-lg hover:bg-secondary/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
              >
                {m.common.save}
              </button>
              <button
                onClick={() => {
                  setShowSettingsDialog(false);
                  setTempWorkHours(workHours);
                  setTempBreakAfterEvents(breakAfterEvents);
                  setTempFocusMinutes(focusMinutes);
                  setTempSkipDurationPrompt(skipDurationPrompt);
                }}
                className="cancel-btn px-4 py-2 text-primary rounded-lg border transition-colors"
              >
                {m.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* First-time Tutorial */}
      {showTutorial && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-4">
            <h3 className="text-xl font-bold text-primary mb-1">{m.tutorial.welcome}</h3>
            <p className="text-sm text-gray-600 mb-4">{m.tutorial.subtitle}</p>

            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              {tutorialStep === 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-gray-900">{m.tutorial.step1Title}</h4>
                  <p className="text-sm text-gray-700">{m.tutorial.step1Body}</p>
                </div>
              )}
              {tutorialStep === 1 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-gray-900">{m.tutorial.step2Title}</h4>
                  <p className="text-sm text-gray-700">{m.tutorial.step2Body}</p>
                </div>
              )}
              {tutorialStep === 2 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-gray-900">{m.tutorial.step3Title}</h4>
                  <p className="text-sm text-gray-700">{m.tutorial.step3Body}</p>
                </div>
              )}
              {tutorialStep === 3 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-gray-900">{m.tutorial.step4Title}</h4>
                  <p className="text-sm text-gray-700">{m.tutorial.step4Body}</p>
                </div>
              )}
              {tutorialStep === 4 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-gray-900">{m.tutorial.readyTitle}</h4>
                  <p className="text-sm text-gray-700">{m.tutorial.readyBody}</p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              {(tutorialStep === 0 || tutorialStep === 1) && (
                <button
                  type="button"
                  onClick={() => {
                    setShowTutorial(false);
                    setTempWorkHours(workHours);
                    setTempBreakAfterEvents(breakAfterEvents);
                    setTempFocusMinutes(focusMinutes);
                    setTempSkipDurationPrompt(skipDurationPrompt);
                    setShowSettingsDialog(true);
                  }}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  {m.tutorial.openSettings}
                </button>
              )}
              {tutorialStep === 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowTutorial(false);
                    setShowSubscriptionDialog(true);
                    if (googleConnected) void loadGoogleCalendarList();
                  }}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  {m.tutorial.openSubscribe}
                </button>
              )}
              {tutorialStep === 2 && (
                <button
                  type="button"
                  onClick={() => {
                    setTaskDurationMode('preset');
                    setShowTutorial(false);
                    setShowAddTaskDialog(true);
                  }}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  {m.tutorial.openAddTask}
                </button>
              )}
            </div>

            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={completeTutorial}
                className="skip-btn px-4 py-2 bg-neutral text-gray-700 rounded-lg hover:bg-neutral/90 transition-colors"
              >
                {m.common.skip}
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setTutorialStep((s) => Math.max(0, s - 1))}
                disabled={tutorialStep === 0}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {m.common.back}
              </button>
              {tutorialStep < 4 ? (
                <button
                  type="button"
                  onClick={() => setTutorialStep((s) => Math.min(4, s + 1))}
                  className="px-4 py-2 bg-secondary text-white rounded-lg hover:bg-secondary/90 transition-colors"
                >
                  {m.common.next}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={completeTutorial}
                  className="px-4 py-2 bg-secondary text-white rounded-lg hover:bg-secondary/90 transition-colors"
                >
                  {m.common.finish}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </main>
  );
}

