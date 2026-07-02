'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Task, CalendarEvent, InAppNotification, UserProfile } from '@/types';
import { storage } from '@/lib/storage';
import { sendEmailNotificationsForUser } from '@/lib/notify-by-email';
import { syncCalendarFeedToServer } from '@/lib/sync-calendar-feed';
import {
  buildCalendarFeedUrl,
  getCalendarFeedServiceOrigin,
  isLocalhostFeedOrigin,
  probePublicCalendarFeedHealth,
} from '@/lib/calendar-feed-url';
import { filterEventsForCalendarFeed } from '@/lib/calendar-feed-events';
import { CalendarAIAgent } from '@/lib/ai-agent';
import { SCHEDULE_MAX_HORIZON_DAYS } from '@/lib/schedule-constants';
import { formatDateToLocalISO, parseLocalDateInput } from '@/lib/date-utils';
import Calendar from '@/components/Calendar';
import NotificationsBell from '@/components/NotificationsBell';
import { v4 as uuidv4 } from 'uuid';
import Image from 'next/image';
import { Plus, X, Clock, CheckCircle2, ChevronDown, ChevronRight, ChevronLeft, Menu, Calendar as CalendarIcon, LucideCalendarPlus, List, Upload, Link2, Trash2, CheckSquare, Settings, Sparkles } from 'lucide-react';
import { View } from 'react-big-calendar';
import { parseICSFileFromFile, parseICSFileFromFileAsTasks, fetchICSFromURL } from '@/lib/ics-parser';
import { formatMinutesToHoursMinutes } from '@/lib/time-utils';

function dedupeCalendarEventsById(events: CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

export default function Home() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [verificationBannerBusy, setVerificationBannerBusy] = useState(false);
  const [calendarFeedUrl, setCalendarFeedUrl] = useState<string | null>(null);
  const [feedSyncError, setFeedSyncError] = useState<string | null>(null);
  const [feedLinkCopied, setFeedLinkCopied] = useState(false);
  const [feedSyncedEventCount, setFeedSyncedEventCount] = useState<number | null>(null);
  const [feedSyncing, setFeedSyncing] = useState(false);
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
  const [tempEmailNotifications, setTempEmailNotifications] = useState(true);
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
  
  // Keep refs in sync with state
  useEffect(() => {
    googleEventsRef.current = googleEvents;
  }, [googleEvents]);
  
  useEffect(() => {
    icsSubscribedEventsRef.current = icsSubscribedEvents;
  }, [icsSubscribedEvents]);

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

    // Check for Google Calendar connection
    const tokens = storage.getGoogleTokens();
    if (tokens?.access_token) {
      setGoogleConnected(true);
      fetchGoogleCalendarEvents();
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

    // Handle OAuth callback from URL query params
    const urlParams = new URLSearchParams(window.location.search);
    const accessToken = urlParams.get('access_token');
    const refreshToken = urlParams.get('refresh_token');
    
    if (accessToken) {
      storage.saveGoogleTokens({
        access_token: accessToken,
        refresh_token: refreshToken || undefined,
      });
      setGoogleConnected(true);
      // Clean up URL
      window.history.replaceState({}, '', window.location.pathname);
      fetchGoogleCalendarEvents();
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

    const profile = storage.getUserProfile();
    if (!profile) {
      router.replace('/login');
      return;
    }
    setUserProfile(profile);

    const urlParamsVerify = new URLSearchParams(window.location.search);
    if (urlParamsVerify.get('email_verified') === '1') {
      const verifiedEmail = urlParamsVerify.get('verified_email')?.toLowerCase();
      if (verifiedEmail && profile.email.toLowerCase() === verifiedEmail) {
        const updated = storage.updateUserProfile({ emailVerified: true });
        if (updated) setUserProfile(updated);
      }
      urlParamsVerify.delete('email_verified');
      urlParamsVerify.delete('verified_email');
      const qs = urlParamsVerify.toString();
      window.history.replaceState({}, '', qs ? `?${qs}` : window.location.pathname);
    }

    setAuthReady(true);
    initialAppDataLoadedRef.current = true;
  }, [router]);

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
  const fetchGoogleCalendarEvents = async () => {
    const tokens = storage.getGoogleTokens();
    if (!tokens?.access_token) return;

    setIsLoadingGoogleEvents(true);
    try {
      const now = new Date();
      const timeMin = now.toISOString();
      const timeMax = new Date(
        now.getTime() + SCHEDULE_MAX_HORIZON_DAYS * 24 * 60 * 60 * 1000
      ).toISOString();

      const response = await fetch(
        `/api/calendar/events?access_token=${tokens.access_token}&timeMin=${timeMin}&timeMax=${timeMax}`
      );

      if (response.ok) {
        const data = await response.json();
        const fetchedEvents = data.events.map((event: CalendarEvent) => ({
          ...event,
          start: new Date(event.start),
          end: new Date(event.end),
        }));
        setGoogleEvents(fetchedEvents);
      } else {
        console.error('Failed to fetch Google Calendar events');
        if (response.status === 401) {
          // Token expired, disconnect
          handleDisconnectGoogle();
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
  };

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
          await handleAddTask(taskData);
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
      setFeedSyncError(result.error ?? 'Could not sync calendar feed');
    }
    return result;
  };

  useEffect(() => {
    if (!authReady) return;
    void probePublicCalendarFeedHealth().then(setPublicFeedDeployed);
  }, [authReady]);

  useEffect(() => {
    if (!authReady || !userProfile) return;
    const token = storage.ensureCalendarFeedToken();
    if (!token) return;
    setCalendarFeedUrl(buildCalendarFeedUrl(getCalendarFeedServiceOrigin(), token));
    const refreshed = storage.getUserProfile();
    if (refreshed && refreshed.calendarFeedToken !== userProfile.calendarFeedToken) {
      setUserProfile(refreshed);
    }
  }, [authReady, userProfile?.calendarFeedToken, userProfile?.email, publicFeedDeployed]);

  useEffect(() => {
    if (!authReady || !userProfile || !initialAppDataLoadedRef.current) return;
    const token = userProfile.calendarFeedToken ?? storage.ensureCalendarFeedToken();
    if (!token) return;

    const timer = window.setTimeout(() => {
      void runCalendarFeedSync(token, events, userProfile.username);
    }, 500);

    return () => window.clearTimeout(timer);
  }, [events, authReady, userProfile?.username, userProfile?.calendarFeedToken]);

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
      const added: InAppNotification[] = [];
      for (const n of next) {
        if (!seen.has(n.id)) {
          merged.push(n);
          added.push(n);
          seen.add(n.id);
        }
      }
      merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const user = storage.getUserProfile();
      if (user && added.length > 0) {
        void sendEmailNotificationsForUser(user, added);
      }
      return merged;
    });
  };

  const resendVerificationEmail = async () => {
    if (!userProfile || verificationBannerBusy) return;
    setVerificationBannerBusy(true);
    try {
      const res = await fetch('/api/auth/verify-email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userProfile.email,
          username: userProfile.username,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(typeof data.error === 'string' ? data.error : 'Could not resend verification email.');
        return;
      }
      alert('Verification email sent. Check your inbox.');
    } finally {
      setVerificationBannerBusy(false);
    }
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
    if (!confirm('Generate a new subscription link? Remove the old URL from Google/Apple Calendar.')) {
      return;
    }
    const oldToken = userProfile.calendarFeedToken;
    const token = storage.regenerateCalendarFeedToken();
    if (!token) return;
    const updated = storage.getUserProfile();
    if (updated) setUserProfile(updated);
    const url = buildCalendarFeedUrl(getCalendarFeedServiceOrigin(), token);
    setCalendarFeedUrl(url);
    await runCalendarFeedSync(token, events, updated?.username, oldToken);
  };

  const manualSyncCalendarFeed = async () => {
    if (!userProfile) return;
    const token = userProfile.calendarFeedToken ?? storage.ensureCalendarFeedToken();
    if (!token) return;
    await runCalendarFeedSync(token, events, userProfile.username);
  };

  const handleAddTask = async (taskData: {
    title: string;
    description?: string;
    estimatedDuration?: number;
    priority: 'low' | 'medium' | 'high';
    category?: string;
    dueDate?: string;
  }) => {
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

  // Schedule a single new task immediately
  const scheduleNewTask = (task: Task) => {
    if (task.completedAt) {
      return; // Don't schedule completed tasks
    }

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = CalendarAIAgent.computeScheduleEndDate([task], startDate);

    // Use functional update with refs to ensure we have the latest state
    setEvents(prevEvents => {
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
        [task],
        allExistingEvents,
        startDate,
        endDate,
        segments,
        breakMinutes,
        focusMinutes
      );

      if (scheduledEvents.length > 0) {
        enqueueCadenceNotificationsForEvents(scheduledEvents);
        // Add the scheduled event to the events state
        return [...prevEvents, ...scheduledEvents];
      }
      
      return prevEvents;
    });
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
        return [...currentEvents, ...scheduledEvents];
      }
      
      return currentEvents;
    });
  };

  const handleDeleteTask = (taskId: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== taskId));
    setEvents((prev) => prev.filter((event) => event.taskId !== taskId));
  };

  const handleCompleteTask = (taskId: string, actualDuration: number) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const updatedTask = CalendarAIAgent.recordTaskCompletion(task, actualDuration);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? updatedTask : t)));
    setEvents((prev) => prev.filter((event) => event.taskId !== taskId));
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
      alert('No incomplete tasks to schedule!');
    } else {
      alert('Tasks have been distributed on your calendar!');
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
      description: event.description,
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
      const res = await fetch('/api/assignments/decompose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: event.title,
          description: event.description ?? undefined,
          dueDate: event.start.toISOString(),
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

      const ordered = [...subtasks].sort(
        (a: { order: number }, b: { order: number }) => a.order - b.order
      );
      const assignmentDue = event.start
        ? parseLocalDateInput(formatDateToLocalISO(event.start))
        : undefined;
      const newTasks: Task[] = ordered.map(
        (st: { title: string; description?: string; estimatedMinutes?: number; order: number }) => ({
          id: uuidv4(),
          title: st.title,
          description: st.description,
          estimatedDuration: st.estimatedMinutes ?? 60,
          priority: 'medium',
          category: '',
          dueDate: assignmentDue,
          planStepOrder: st.order,
          createdAt: new Date(),
          actualDurations: [],
        })
      );

      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      const endDate = CalendarAIAgent.computeScheduleEndDate(newTasks, startDate);
      const allExistingEvents = dedupeCalendarEventsById([
        ...events,
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
        newTasks,
        allExistingEvents,
        startDate,
        endDate,
        segments,
        breakMinutes,
        focusMinutes
      );

      setTasks(prev => [...prev, ...newTasks]);
      enqueueCadenceNotificationsForEvents(scheduledEvents);
      setEvents(prev => [...prev, ...scheduledEvents]);

      setShowEventDialog(false);
      setSelectedEvent(null);
      if (confirm(`${newTasks.length} subtasks created and scheduled. Remove this event from the calendar?`)) {
        setEvents(prevEvents => prevEvents.filter(e => e.id !== event.id));
        setGoogleEvents(prevEvents => prevEvents.filter(e => e.id !== event.id));
        setICSSubscribedEvents(prevEvents => prevEvents.filter(e => e.id !== event.id));
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
    if (confirm('Delete this event?')) {
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

  const miniCalendarMonthLabel = miniCalendarDate.toLocaleDateString('en-US', {
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
        dateText: date.toLocaleDateString('en-US', {
          month: 'long',
        }),
        yearText: String(date.getFullYear()),
      };
    }

    if (calendarView === 'day') {
      return {
        dateText: date.toLocaleDateString('en-US', {
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

    const startMonth = start.toLocaleDateString('en-US', { month: 'long' });
    const endMonth = end.toLocaleDateString('en-US', { month: 'long' });
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
        {userProfile && !userProfile.emailVerified && (
          <div className="mx-3 sm:mx-4 xl:mx-6 mt-3 rounded-lg border border-amber-400/40 bg-amber-50 text-amber-950 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Verify <strong>{userProfile.email}</strong> to receive email notifications.
            </span>
            <button
              type="button"
              onClick={() => void resendVerificationEmail()}
              disabled={verificationBannerBusy}
              className="font-semibold text-amber-900 underline hover:no-underline disabled:opacity-60"
            >
              {verificationBannerBusy ? 'Sending…' : 'Resend verification email'}
            </button>
          </div>
        )}
        <div className="header-bar relative bg-primary-dark px-4 py-2.5 mx-3 sm:mx-4 xl:mx-6 mt-3 rounded-lg border dark:border-white/5">
          <div className="grid grid-cols-[145px_1fr_auto] lg:grid-cols-[145px_minmax(130px,1fr)_320px_minmax(190px,1fr)_auto] items-center gap-3 xl:gap-4">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="relative h-12 w-[150px]">
                <Image
                  src="/cadence-logo-white.png"
                  alt="Cadence"
                  fill
                  priority
                  className="object-contain"
                />
              </div>
            </div>

            {/* Calendar navigation */}
            <div className="hidden lg:flex justify-center">
              <div className="header-control-group flex items-center rounded-lg bg-white/10 border border-white/25 overflow-hidden">
                <button
                  type="button"
                  onClick={() => navigateMainCalendar('previous')}
                  className="h-10 px-3.5 flex items-center justify-center text-white text-base font-semibold hover:bg-white/15 transition-colors"
                  aria-label="Previous"
                >
                  <ChevronLeft size={16} strokeWidth={2.5} />
                </button>

                <button
                  type="button"
                  onClick={() => navigateMainCalendar('today')}
                  className="h-10 px-4 flex items-center justify-center gap-1.5 text-white text-base font-semibold hover:bg-white/15 transition-colors tracking-normal"
                >
                  Today
                </button>

                <button
                  type="button"
                  onClick={() => navigateMainCalendar('next')}
                  className="h-10 px-3.5 flex items-center justify-center text-white text-base font-semibold hover:bg-white/15 transition-colors"
                  aria-label="Next"
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
                  aria-label={viewName.charAt(0).toUpperCase() + viewName.slice(1)}
                  title={viewName.charAt(0).toUpperCase() + viewName.slice(1)}
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
                      {viewName.charAt(0).toUpperCase() + viewName.slice(1)}
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
              aria-label="Open menu"
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
                  onClick={() => setShowSubscriptionDialog(!showSubscriptionDialog)}
                  className={`h-9 px-2.5 xl:px-3 flex items-center justify-center gap-1.5 text-sm xl:text-base font-medium transition-colors ${
                    showSubscriptionDialog
                      ? 'bg-white/10 text-white'
                      : 'text-white hover:bg-white/15'
                  }`}
                  title="Subscribe to ICS calendar URL"
                >
                  <LucideCalendarPlus size={20} />
                  <span className="hidden xl:inline">Subscribe</span>
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
                    if (!confirm('Clear all notifications?')) return;
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
                    setTempEmailNotifications(userProfile?.emailNotificationsEnabled ?? true);
                    setShowSettingsDialog(true);
                  }}
                  className="h-9 w-9 flex items-center justify-center text-white hover:bg-white/15 transition-colors"
                  title="Settings"
                  aria-label="Settings"
                >
                  <Settings size={20} />
                </button>
              </div>

              {/* Subscription Dialog */}
              {showSubscriptionDialog && (
                <div className="subscription-dropdown absolute right-0 top-12 w-96 bg-white rounded-lg shadow-xl border border-gray-200 z-50 p-4">
                  <h3 className="text-lg font-[700] text-primary mb-3">
                    Subscribe to Calendar
                  </h3>

                  <div className="space-y-3">
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
                      {isImportingICS ? 'Importing...' : 'Import ICS File'}
                    </button>

                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-gray-200" />
                      <span className="text-xs text-gray-400">or subscribe by URL</span>
                      <div className="h-px flex-1 bg-gray-200" />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-primary mb-1">
                        Calendar URL *
                      </label>
                      <input
                        type="url"
                        value={newSubscriptionUrl}
                        onChange={(e) => setNewSubscriptionUrl(e.target.value)}
                        placeholder="ICS or Google embed URL"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Enter a public ICS calendar feed URL or a Google Calendar embed link
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-primary mb-1">
                        Calendar Name (Optional)
                      </label>
                      <input
                        type="text"
                        value={newSubscriptionName}
                        onChange={(e) => setNewSubscriptionName(e.target.value)}
                        placeholder="My Calendar"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                    </div>

                    {/* Susbcribed Calendars */}
                    {icsSubscriptions.length > 0 && (
                      <div className="pt-3 mt-3 border-t border-gray-200">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <h4 className="text-sm font-semibold text-primary">
                            Subscribed Calendars
                          </h4>

                          <button
                            type="button"
                            onClick={() => fetchAllICSSubscriptions()}
                            disabled={isLoadingICSSubscription}
                            className="text-xs px-2 py-1 text-primary-600 hover:bg-primary-50/10 rounded transition-colors disabled:opacity-50"
                          >
                            {isLoadingICSSubscription ? 'Refreshing…' : 'Refresh all'}
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
                                  title="Choose calendar color"
                                >
                                  <span
                                    className="w-3.5 h-3.5 rounded border border-gray-300"
                                    style={{ backgroundColor: sub.color || '#8b5cf6' }}
                                  />
                                  Color
                                </button>

                                {openColorMenuId === sub.id && (
                                  <div className="absolute right-0 top-full mt-1 z-[999] bg-white border border-gray-200 rounded-lg shadow-lg p-2 min-w-[180px]">
                                    <p className="text-xs font-medium text-gray-600 mb-2">
                                      Pick a color
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
                                      <span className="text-xs text-gray-500">Custom</span>
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
                        {isLoadingICSSubscription ? 'Adding...' : 'Add Subscription'}
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
                {isImportingICS ? 'Importing...' : 'Import ICS'}
              </button>

              <button
                onClick={() => {
                  setShowSubscriptionDialog(true);
                  setTasksDropdownOpen(false);
                  setMobileMenuOpen(false);
                }}
                className="mobile-menu-btn subscribe-btn w-full flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-white/10 text-white border border-white/25"
              >
                <Link2 size={18} />
                Subscribe
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
                  Tasks
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
                  setShowSettingsDialog(true);
                  setMobileMenuOpen(false);
                }}
                className="mobile-menu-btn settings-btn w-full flex items-center gap-2 px-3.5 py-2.5 rounded-lg bg-white/10 text-white border border-white/25"
              >
                <Settings size={18} />
                Settings
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
                  <h2 className="text-xl font-semibold text-primary">Tasks</h2>
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
                    Active ({activeTasks.length})
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
                    Completed ({completedTasks.length})
                  </button>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                  {displayedTasks.length === 0 ? (
                    <p className="text-gray-600 text-center py-6 text-sm">No {taskSidebarTab} tasks</p>
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
                                  {task.priority}
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
                            <p className="text-xs leading-4 text-gray-500">
                              {task.description}
                            </p>
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-500">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                            <div className="flex items-center gap-1 font-medium text-primary">
                              <Clock size={12} />
                              <span>
                                Avg: {formatMinutesToHoursMinutes(getAverageDuration(task))}
                              </span>
                            </div>

                            {task.actualDurations.length > 0 && (
                              <span className="text-gray-400">
                                ({task.actualDurations.length} completed)
                              </span>
                            )}

                            {task.dueDate && (
                              <span className="font-medium text-orange-600">
                                Due: {new Date(task.dueDate).toLocaleDateString()}
                              </span>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-1">
                            {!task.completedAt && (
                              <button
                                onClick={() => {
                                  const duration = prompt('How long did this task actually take? (in minutes)');
                                  if (duration) {
                                    handleCompleteTask(task.id, parseInt(duration));
                                  }
                                }}
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
                  {['S','M','T','W','T','F','S'].map(d => <div key={d}>{d}</div>)}
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
                <h3 className="text-xl font-bold text-primary">Add Task</h3>
              </div>
              <button
                onClick={() => setShowAddTaskDialog(false)}
                className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="Close"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (newTask.title.trim()) {
                  handleAddTask(newTask);
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
                  placeholder="Task title *"
                  required
                  autoFocus
                />
                <textarea
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Description"
                  rows={3}
                />

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Estimated Duration
                  </label>
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-2">
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
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      >
                        {[30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600].map((mins) => (
                          <option key={mins} value={mins}>
                            {formatMinutesToHoursMinutes(mins)}
                          </option>
                        ))}
                        <option value="custom">Custom (hours)</option>
                      </select>
                      {taskDurationMode === 'custom' && (
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
                    <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-700 min-w-[140px] flex items-center">
                      {formatMinutesToHoursMinutes(newTask.estimatedDuration || 0)}
                    </div>
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
                  <p className="text-sm font-medium text-gray-700">Schedule automatically</p>
                  <p className="text-xs text-gray-500">
                    Add this task directly to the calendar
                  </p>
                </div>
                
                <button
                  type="button"
                  onClick={() => setAutoScheduleNewTask(prev => !prev)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
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
                  className="flex-1 px-4 py-2 bg-secondary text-white rounded-lg hover:bg-secondary/90 transition-colors"
                >
                  Add Task
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddTaskDialog(false)}
                  className="cancel-btn px-4 py-2 text-primary rounded-lg border transition-colors"
                >
                  Cancel
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
                  <p className="text-sm text-gray-600 mt-1 whitespace-pre-line break-words max-h-40 overflow-y-auto pr-1">
                    {selectedEvent.description}
                  </p>
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
                <div className="flex gap-2 items-center">
                  <div className="flex-1 space-y-2">
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
                  <div className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-700 min-w-[140px]">
                    {formatMinutesToHoursMinutes(conversionDuration)}
                  </div>
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
      {showSettingsDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto border border-gray-200">
            <h3 className="text-xl font-bold text-primary mb-1">Settings</h3>
            <p className="text-sm text-gray-600 mb-6">Configure scheduling and calendar behavior</p>
            
            <div className="space-y-6">
              {userProfile && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-800 mb-2">Email notifications</h4>
                  <p className="text-xs text-gray-500 mb-2">
                    Signed in as <strong>{userProfile.username}</strong> ({userProfile.email}
                    {userProfile.emailVerified ? ', verified' : ', not verified'})
                  </p>
                  <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tempEmailNotifications}
                      onChange={(e) => setTempEmailNotifications(e.target.checked)}
                      className="mt-0.5"
                      disabled={!userProfile.emailVerified}
                    />
                    <span>
                      Send schedule updates to this email when Cadence creates calendar blocks
                    </span>
                  </label>
                  {!userProfile.emailVerified && (
                    <p className="text-xs text-amber-700 mt-2">
                      Verify your email from the banner at the top to enable delivery.
                    </p>
                  )}
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <Link2 size={16} />
                  Subscribe in Google / Apple Calendar
                </h4>
                <p className="text-xs text-gray-500 mb-2">
                  Add this link as a calendar subscription. Only <strong>Cadence-scheduled blocks</strong>{' '}
                  on your in-app calendar are published (not Google/ICS imports). Updates can take up to
                  several hours in Google Calendar.
                </p>
                {devUsesPublicCadenceFeed && publicFeedDeployed === false && (
                  <div className="mb-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-950">
                    <strong>Google Calendar can&apos;t load your feed yet.</strong> The live site at{' '}
                    www.bridgerscadence.com does not have the calendar-feed API deployed (we checked).
                    Deploy the latest Cadence build to Vercel, connect <strong>Vercel Blob</strong> storage,
                    then click <strong>Sync now</strong> and re-subscribe in Google Calendar.
                  </div>
                )}
                {devUsesPublicCadenceFeed && publicFeedDeployed === true && (
                  <div className="mb-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
                    You&apos;re on localhost; this link uses <strong>www.bridgerscadence.com</strong>. Click{' '}
                    <strong>Sync now</strong> after scheduling so Google can pull your blocks.
                  </div>
                )}
                {calendarFeedUrl ? (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-700">
                      On feed:{' '}
                      <strong>
                        {feedSyncedEventCount ?? feedPublishPreviewCount} event
                        {(feedSyncedEventCount ?? feedPublishPreviewCount) === 1 ? '' : 's'}
                      </strong>
                      {feedPublishPreviewCount === 0 && (
                        <span className="text-amber-800">
                          {' '}
                          — add a task with auto-schedule (or distribute tasks) so blocks appear here
                          first.
                        </span>
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
                        {feedLinkCopied ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      Google: Other calendars → From URL. Apple: File → New Calendar Subscription.
                    </p>
                    {feedSyncError && (
                      <p className="text-xs text-red-600">{feedSyncError}</p>
                    )}
                    <div className="flex flex-wrap gap-3 items-center">
                      <button
                        type="button"
                        disabled={feedSyncing}
                        onClick={() => void manualSyncCalendarFeed()}
                        className="text-xs font-medium text-primary-700 underline hover:no-underline disabled:opacity-60"
                      >
                        {feedSyncing ? 'Syncing…' : 'Sync now'}
                      </button>
                      {calendarFeedUrl && (
                        <a
                          href={calendarFeedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-gray-700 underline hover:no-underline"
                        >
                          Preview feed
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void rotateCalendarFeedLink()}
                        className="text-xs text-gray-600 underline hover:no-underline"
                      >
                        Generate new link
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">Loading your subscription link…</p>
                )}
              </div>

              {/* Working Hours */}
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <Clock size={16} />
                  Working Hours
                </h4>
                <p className="text-xs text-gray-500 mb-2">
                  Tasks are only scheduled during these hours (Mon–Fri). Define one or more work blocks per day.
                </p>
                <div className="space-y-3">
                  {tempWorkHours.segments.map((segment, index) => (
                    <div key={index} className="flex items-end gap-2">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Start</label>
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
                        <label className="block text-xs font-medium text-gray-600 mb-1">End</label>
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
                    className="text-xs text-primary-600 hover:text-primary-700"
                  >
                    + Add work segment
                  </button>
                </div>
                {!isTempWorkHoursValid && (
                  <p className="text-xs text-red-600 mt-1">
                    Each segment must have an end hour after its start hour, and at least one segment is required.
                  </p>
                )}
              </div>

              {/* Break after events */}
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2">Break After Each Event</h4>
                <p className="text-xs text-gray-500 mb-2">Gap (in minutes) before another task can be scheduled after an event or task</p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={tempBreakAfterEvents}
                    onChange={(e) => setTempBreakAfterEvents(Math.max(0, parseInt(e.target.value) || 0))}
                    min={0}
                    max={120}
                    className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-600">minutes</span>
                </div>
              </div>

              {/* Focus hours */}
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2">Focus Duration</h4>
                <p className="text-xs text-gray-500 mb-2">How long you feel comfortable focusing on a task. Longer tasks are split into chunks of this size (30 min – 3 hours)</p>
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

              {/* Appearance */}
            <div>
              <h4 className="text-sm font-semibold text-gray-800 mb-2">Appearance</h4>
              <p className="text-xs text-gray-500 mb-2">Toggle between light and dark mode</p>

              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700">
                  {darkMode ? 'Dark Mode' : 'Light Mode'}
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

              {/* Tutorial */}
              <div>
                <h4 className="text-sm font-semibold text-gray-800 mb-2">Tutorial</h4>
                <p className="text-xs text-gray-500 mb-2">Run the first-time setup walkthrough again</p>
                <button
                  type="button"
                  onClick={() => {
                    setShowSettingsDialog(false);
                    startTutorial();
                  }}
                    className="replay-btn w-full px-4 py-2 rounded-lg text-sm font-medium border transition-colors"
                >
                  Replay tutorial
                </button>
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
                  if (userProfile) {
                    const updated = storage.updateUserProfile({
                      emailNotificationsEnabled: tempEmailNotifications,
                    });
                    if (updated) setUserProfile(updated);
                  }
                  setShowSettingsDialog(false);
                }}
                disabled={!isTempWorkHoursValid}
                className="flex-1 px-4 py-2 bg-secondary text-white rounded-lg hover:bg-secondary/90 disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setShowSettingsDialog(false);
                  setTempWorkHours(workHours);
                  setTempBreakAfterEvents(breakAfterEvents);
                  setTempFocusMinutes(focusMinutes);
                }}
                className="cancel-btn px-4 py-2 text-primary rounded-lg border transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* First-time Tutorial */}
      {showTutorial && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full mx-4">
            <h3 className="text-xl font-bold text-primary mb-1">Welcome to Cadence</h3>
            <p className="text-sm text-gray-600 mb-4">A quick walkthrough to get your schedule working</p>

            <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              {tutorialStep === 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-gray-900">Step 1: Set your working hours</h4>
                  <p className="text-sm text-gray-700">
                    Cadence only schedules tasks inside your work blocks (Mon–Fri). Add multiple segments if you work
                    split shifts.
                  </p>
                </div>
              )}
              {tutorialStep === 1 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-gray-900">Step 2: Connect calendars</h4>
                  <p className="text-sm text-gray-700">
                    Use <span className="font-medium">Subscribe</span> for public ICS feeds or Google Calendar embed links.
                    All-day placeholders (like Canvas due dates) won’t block scheduling.
                  </p>
                </div>
              )}
              {tutorialStep === 2 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-gray-900">Step 3: Add a task</h4>
                  <p className="text-sm text-gray-700">
                    Create a manual task with an estimated duration and due date. Cadence will split it into focus-sized
                    chunks and distribute it across available days.
                  </p>
                </div>
              )}
              {tutorialStep === 3 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-gray-900">Step 4: Understand priority</h4>
                  <p className="text-sm text-gray-700">
                    High priority tends to claim earlier slots. Medium/Low will still schedule fully, but may be placed
                    around higher-priority work.
                  </p>
                </div>
              )}
              {tutorialStep === 4 && (
                <div className="space-y-2">
                  <h4 className="font-semibold text-gray-900">You’re ready</h4>
                  <p className="text-sm text-gray-700">
                    Tip: if your schedule looks too “chunky”, adjust <span className="font-medium">Focus Duration</span>{' '}
                    in Settings.
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              {tutorialStep === 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowTutorial(false);
                    setShowSettingsDialog(true);
                  }}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  Open Settings
                </button>
              )}
              {tutorialStep === 1 && (
                <button
                  type="button"
                  onClick={() => {
                    setShowTutorial(false);
                    setShowSubscriptionDialog(true);
                  }}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50 transition-colors"
                >
                  Open Subscribe
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
                  Open Add Task
                </button>
              )}
            </div>

            <div className="flex gap-3 mt-6 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={completeTutorial}
                className="skip-btn px-4 py-2 bg-neutral text-gray-700 rounded-lg hover:bg-neutral/90 transition-colors"
              >
                Skip
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setTutorialStep((s) => Math.max(0, s - 1))}
                disabled={tutorialStep === 0}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Back
              </button>
              {tutorialStep < 4 ? (
                <button
                  type="button"
                  onClick={() => setTutorialStep((s) => Math.min(4, s + 1))}
                  className="px-4 py-2 bg-secondary text-white rounded-lg hover:bg-secondary/90 transition-colors"
                >
                  Next
                </button>
              ) : (
                <button
                  type="button"
                  onClick={completeTutorial}
                  className="px-4 py-2 bg-secondary text-white rounded-lg hover:bg-secondary/90 transition-colors"
                >
                  Finish
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

