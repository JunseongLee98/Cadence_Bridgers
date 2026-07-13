import React, { useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Task, CalendarEvent, WorkHoursConfig } from '@/types';
import { CalendarAIAgent } from '@/lib/ai-agent';
import { SCHEDULE_MAX_HORIZON_DAYS } from '../../lib/schedule-constants';
import { cadenceRequest } from '@/lib/cadence-request';
import { parseICSFile } from '@/lib/ics-parser';

const TASKS_KEY = 'cadence_tasks';
const EVENTS_KEY = 'cadence_events';
const GOOGLE_TOKENS_KEY = 'cadence_google_tokens';
const ICS_SUBSCRIPTIONS_KEY = 'cadence_ics_subscriptions';
const WORK_HOURS_KEY = 'cadence_work_hours';
const BREAK_AFTER_KEY = 'cadence_break_after_events';
const FOCUS_KEY = 'cadence_focus_minutes';
const OAUTH_CLIENT_KEY = 'cadence_google_oauth_client_id';

function parseTasks(raw: unknown): Task[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((t: any) => ({
    ...t,
    createdAt: new Date(t.createdAt),
    completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
    dueDate: t.dueDate ? new Date(t.dueDate) : undefined,
  }));
}

function parseEvents(raw: unknown): CalendarEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e: any) => ({
    ...e,
    start: new Date(e.start),
    end: new Date(e.end),
  }));
}

function defaultWorkHours(): WorkHoursConfig {
  return { segments: [{ startHour: 9, endHour: 18 }] };
}

function parseWorkHours(data: string | undefined): WorkHoursConfig {
  if (!data) return defaultWorkHours();
  try {
    const parsed = JSON.parse(data);
    if (parsed?.segments && Array.isArray(parsed.segments)) {
      const segs = parsed.segments.filter(
        (s: any) => typeof s.startHour === 'number' && typeof s.endHour === 'number' && s.startHour < s.endHour
      );
      if (segs.length) return { segments: segs };
    }
  } catch {
    /* ignore */
  }
  return defaultWorkHours();
}

export function CadencePanel(): React.ReactElement {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([]);
  const [icsSubs, setIcsSubs] = useState<Array<{ id: string; url: string; name: string }>>([]);
  const [workHours, setWorkHours] = useState<WorkHoursConfig>(defaultWorkHours());
  const [breakAfter, setBreakAfter] = useState(5);
  const [focusMinutes, setFocusMinutes] = useState(50);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newTitle, setNewTitle] = useState('');
  const [newDuration, setNewDuration] = useState(60);
  const [newPriority, setNewPriority] = useState<'low' | 'medium' | 'high'>('medium');

  const [aiTitle, setAiTitle] = useState('');
  const [aiDesc, setAiDesc] = useState('');

  const [icsUrl, setIcsUrl] = useState('');
  const [icsName, setIcsName] = useState('');

  const persist = useCallback(async (patch: Record<string, unknown>) => {
    await chrome.storage.local.set(patch);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await chrome.storage.local.get([
        TASKS_KEY,
        EVENTS_KEY,
        GOOGLE_TOKENS_KEY,
        ICS_SUBSCRIPTIONS_KEY,
        WORK_HOURS_KEY,
        BREAK_AFTER_KEY,
        FOCUS_KEY,
      ]);

      const tasksRaw = data[TASKS_KEY];
      setTasks(typeof tasksRaw === 'string' ? parseTasks(JSON.parse(tasksRaw)) : []);

      const eventsRaw = data[EVENTS_KEY];
      setEvents(typeof eventsRaw === 'string' ? parseEvents(JSON.parse(eventsRaw)) : []);

      const tok = data[GOOGLE_TOKENS_KEY];
      let connected = false;
      if (typeof tok === 'string') {
        try {
          const p = JSON.parse(tok);
          connected = Boolean(p?.access_token);
        } catch {
          connected = false;
        }
      }
      setGoogleConnected(connected);

      const subsRaw = data[ICS_SUBSCRIPTIONS_KEY];
      setIcsSubs(typeof subsRaw === 'string' ? JSON.parse(subsRaw) : []);

      setWorkHours(parseWorkHours(data[WORK_HOURS_KEY] as string | undefined));

      const br = data[BREAK_AFTER_KEY];
      setBreakAfter(br != null ? parseInt(String(br), 10) || 5 : 5);

      const fm = data[FOCUS_KEY];
      setFocusMinutes(fm != null ? Math.max(30, Math.min(180, parseInt(String(fm), 10) || 50)) : 50);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const saveTasks = async (next: Task[]) => {
    setTasks(next);
    await persist({ [TASKS_KEY]: JSON.stringify(next) });
  };

  const saveEvents = async (next: CalendarEvent[]) => {
    setEvents(next);
    await persist({ [EVENTS_KEY]: JSON.stringify(next) });
  };

  const saveWorkHoursConfig = async (wh: WorkHoursConfig) => {
    setWorkHours(wh);
    await persist({ [WORK_HOURS_KEY]: JSON.stringify(wh) });
  };

  const fetchGoogleEvents = async (): Promise<CalendarEvent[]> => {
    const data = await chrome.storage.local.get(GOOGLE_TOKENS_KEY);
    const raw = data[GOOGLE_TOKENS_KEY];
    if (!raw || typeof raw !== 'string') throw new Error('Connect Google first');
    const tokens = JSON.parse(raw) as { access_token?: string };
    if (!tokens.access_token) throw new Error('No access token');
    const now = new Date();
    const timeMin = now.toISOString();
    const timeMax = new Date(
      now.getTime() + SCHEDULE_MAX_HORIZON_DAYS * 24 * 60 * 60 * 1000
    ).toISOString();
    const { events: evs } = await cadenceRequest<{ events: CalendarEvent[] }>({
      type: 'CADENCE_GET_GOOGLE_EVENTS',
      payload: { accessToken: tokens.access_token, timeMin, timeMax },
    });
    const mapped = evs.map((e) => ({
      ...e,
      start: new Date(e.start as unknown as string),
      end: new Date(e.end as unknown as string),
    }));
    setGoogleEvents(mapped);
    return mapped;
  };

  const handleConnectGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      const { [OAUTH_CLIENT_KEY]: cid } = await chrome.storage.local.get(OAUTH_CLIENT_KEY);
      const id = (cid as string)?.trim() || '';
      if (!id) {
        setError('Set OAuth Client ID in extension options (right-click extension → Options).');
        return;
      }
      await cadenceRequest({ type: 'CADENCE_OAUTH_GOOGLE', payload: { clientId: id } });
      setGoogleConnected(true);
      await reload();
      await fetchGoogleEvents();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleAddTask = async () => {
    if (!newTitle.trim()) return;
    const task: Task = {
      id: uuidv4(),
      title: newTitle.trim(),
      estimatedDuration: newDuration,
      priority: newPriority,
      category: '',
      createdAt: new Date(),
      actualDurations: [],
    };
    await saveTasks([...tasks, task]);
    setNewTitle('');

    let ge: CalendarEvent[] = googleEvents;
    if (googleConnected) {
      try {
        ge = await fetchGoogleEvents();
      } catch {
        ge = googleEvents;
      }
    }

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    const endDate = CalendarAIAgent.computeScheduleEndDate([task], startDate);
    const allExisting = [...events, ...ge];
    const scheduled = CalendarAIAgent.distributeTasks(
      [task],
      allExisting,
      startDate,
      endDate,
      workHours.segments,
      breakAfter,
      focusMinutes
    );
    if (scheduled.length) {
      await saveEvents([...events, ...scheduled]);
    }
  };

  const handleDistribute = async () => {
    setBusy(true);
    setError(null);
    try {
      let ge: CalendarEvent[] = [];
      if (googleConnected) {
        try {
          ge = await fetchGoogleEvents();
        } catch {
          ge = [];
        }
      }
      const incomplete = tasks.filter((t) => !t.completedAt);
      if (!incomplete.length) {
        setError('No tasks to schedule.');
        return;
      }
      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      const endDate = CalendarAIAgent.computeScheduleEndDate(incomplete, startDate);

      let icsEvents: CalendarEvent[] = [];
      for (const sub of icsSubs) {
        try {
          const { body } = await cadenceRequest<{ body: string }>({
            type: 'CADENCE_FETCH_ICS',
            payload: { url: sub.url },
          });
          icsEvents = [...icsEvents, ...parseICSFile(body)];
        } catch {
          /* skip bad feed */
        }
      }

      const allExisting = [...events, ...ge, ...icsEvents];
      const scheduledTaskIds = new Set(events.filter((e) => e.taskId).map((e) => e.taskId));
      const unscheduled = incomplete.filter((t) => !scheduledTaskIds.has(t.id));
      if (!unscheduled.length) {
        setError('All tasks already have schedule blocks.');
        return;
      }
      const scheduled = CalendarAIAgent.distributeTasks(
        unscheduled,
        allExisting,
        startDate,
        endDate,
        workHours.segments,
        breakAfter,
        focusMinutes
      );
      if (scheduled.length) {
        await saveEvents([...events, ...scheduled]);
      } else {
        setError('No free slots found. Adjust work hours or calendar.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleDecompose = async () => {
    if (!aiTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { subtasks } = await cadenceRequest<{
        subtasks: Array<{
          title: string;
          description?: string;
          estimatedMinutes?: number;
          workAmount?: number;
          workUnit?: string;
          order: number;
        }>;
      }>({
        type: 'CADENCE_DECOMPOSE',
        payload: {
          title: aiTitle.trim(),
          description: aiDesc || undefined,
          locale: navigator.language.toLowerCase().startsWith('ko') ? 'ko' : 'en',
        },
      });
      const ordered = [...subtasks].sort((a, b) => a.order - b.order);
      const planId = uuidv4();
      const newTasks: Task[] = ordered.map((st) => ({
        id: uuidv4(),
        title: st.title,
        description: st.description,
        estimatedDuration: st.estimatedMinutes ?? 60,
        priority: 'medium' as const,
        category: '',
        planStepOrder: st.order,
        planId,
        procedureTitle: st.title,
        procedureDescription: st.description,
        ...(st.workAmount !== undefined && st.workUnit
          ? { workAmount: st.workAmount, workUnit: st.workUnit }
          : {}),
        createdAt: new Date(),
        actualDurations: [],
      }));
      const merged = [...tasks, ...newTasks];
      await saveTasks(merged);

      let ge: CalendarEvent[] = googleEvents;
      if (googleConnected) {
        try {
          ge = await fetchGoogleEvents();
        } catch {
          ge = googleEvents;
        }
      }

      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      const endDate = CalendarAIAgent.computeScheduleEndDate(newTasks, startDate);
      const allExisting = [...events, ...ge];
      const scheduled = CalendarAIAgent.distributeTasks(
        newTasks,
        allExisting,
        startDate,
        endDate,
        workHours.segments,
        breakAfter,
        focusMinutes
      );
      if (scheduled.length) {
        await saveEvents([...events, ...scheduled]);
      }
      setAiTitle('');
      setAiDesc('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleAddIcs = async () => {
    if (!icsUrl.trim() || !icsUrl.startsWith('https://')) {
      setError('ICS URL must be HTTPS.');
      return;
    }
    const sub = {
      id: `ics-sub-${Date.now()}`,
      url: icsUrl.trim(),
      name: icsName.trim() || new URL(icsUrl).hostname,
    };
    const next = [...icsSubs, sub];
    setIcsSubs(next);
    await persist({ [ICS_SUBSCRIPTIONS_KEY]: JSON.stringify(next) });
    setIcsUrl('');
    setIcsName('');
  };

  const removeTask = async (id: string) => {
    await saveTasks(tasks.filter((t) => t.id !== id));
    await saveEvents(events.filter((e) => e.taskId !== id));
  };

  const addSegment = () => {
    saveWorkHoursConfig({
      segments: [...workHours.segments, { startHour: 9, endHour: 18 }],
    });
  };

  const updateSegment = (index: number, patch: Partial<{ startHour: number; endHour: number }>) => {
    const segments = workHours.segments.map((s, i) => (i === index ? { ...s, ...patch } : s));
    saveWorkHoursConfig({ segments });
  };

  const removeSegment = (index: number) => {
    if (workHours.segments.length <= 1) return;
    saveWorkHoursConfig({ segments: workHours.segments.filter((_, i) => i !== index) });
  };

  const scheduledForDisplay = events.filter((e) => e.taskId);

  if (loading) {
    return (
      <div className="cadence-panel">
        <div className="cadence-header">
          <h1>Cadence</h1>
        </div>
        <div className="cadence-scroll muted">Loading…</div>
      </div>
    );
  }

  return (
    <div className="cadence-panel">
      <div className="cadence-header">
        <h1>Cadence</h1>
        <p className="muted" style={{ margin: '4px 0 0', fontSize: 12 }}>
          On Google Calendar — tasks & AI scheduling
        </p>
      </div>
      <div className="cadence-scroll">
        {error && <div className="section error">{error}</div>}

        <div className="section">
          <h2>Google Calendar</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            {googleConnected ? 'Connected — busy times load when you distribute.' : 'Connect to read busy times from your primary calendar.'}
          </p>
          <div className="row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={handleConnectGoogle}>
              {googleConnected ? 'Reconnect Google' : 'Connect Google'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => chrome.runtime.openOptionsPage()}>
              Options
            </button>
          </div>
        </div>

        <div className="section">
          <h2>Work hours (weekdays)</h2>
          {workHours.segments.map((seg, i) => (
            <div key={i} className="segment-row">
              <select
                value={seg.startHour}
                onChange={(e) => updateSegment(i, { startHour: parseInt(e.target.value, 10) })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {h}:00
                  </option>
                ))}
              </select>
              <span className="muted">to</span>
              <select
                value={seg.endHour}
                onChange={(e) => updateSegment(i, { endHour: parseInt(e.target.value, 10) })}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {h}:00
                  </option>
                ))}
              </select>
              {workHours.segments.length > 1 && (
                <button type="button" className="btn btn-danger btn-sm" onClick={() => removeSegment(i)}>
                  Remove
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn btn-secondary btn-sm" onClick={addSegment}>
            + Segment
          </button>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="muted">
              Break after events (min){' '}
              <input
                type="number"
                min={0}
                max={120}
                value={breakAfter}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10) || 0;
                  setBreakAfter(v);
                  persist({ [BREAK_AFTER_KEY]: String(v) });
                }}
                style={{ width: 64 }}
              />
            </label>
            <label className="muted">
              Focus (min){' '}
              <input
                type="number"
                min={30}
                max={180}
                value={focusMinutes}
                onChange={(e) => {
                  const v = Math.max(30, Math.min(180, parseInt(e.target.value, 10) || 50));
                  setFocusMinutes(v);
                  persist({ [FOCUS_KEY]: String(v) });
                }}
                style={{ width: 64 }}
              />
            </label>
          </div>
        </div>

        <div className="section">
          <h2>Add task</h2>
          <input type="text" placeholder="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <input
              type="number"
              min={15}
              value={newDuration}
              onChange={(e) => setNewDuration(parseInt(e.target.value, 10) || 60)}
              style={{ width: 100 }}
            />
            <select value={newPriority} onChange={(e) => setNewPriority(e.target.value as 'low' | 'medium' | 'high')}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <button type="button" className="btn btn-primary" onClick={handleAddTask}>
              Add & schedule
            </button>
          </div>
        </div>

        <div className="section">
          <h2>AI breakdown</h2>
          <input type="text" placeholder="Assignment title" value={aiTitle} onChange={(e) => setAiTitle(e.target.value)} />
          <textarea
            placeholder="Description (optional)"
            value={aiDesc}
            onChange={(e) => setAiDesc(e.target.value)}
            style={{ marginTop: 8 }}
          />
          <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy} onClick={handleDecompose}>
            Break down & schedule
          </button>
        </div>

        <div className="section">
          <h2>ICS subscription</h2>
          <input type="text" placeholder="https://…" value={icsUrl} onChange={(e) => setIcsUrl(e.target.value)} />
          <input
            type="text"
            placeholder="Name"
            value={icsName}
            onChange={(e) => setIcsName(e.target.value)}
            style={{ marginTop: 8 }}
          />
          <button type="button" className="btn btn-secondary" style={{ marginTop: 8 }} onClick={handleAddIcs}>
            Add feed
          </button>
          {icsSubs.length > 0 && (
            <ul className="muted" style={{ paddingLeft: 18, marginBottom: 0 }}>
              {icsSubs.map((s) => (
                <li key={s.id}>{s.name}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="section">
          <h2>Tasks</h2>
          {tasks.length === 0 && <p className="muted">No tasks yet.</p>}
          {tasks.map((t) => (
            <div key={t.id} className="task-item">
              <div>
                <strong>{t.title}</strong>
                <div className="muted">
                  {t.estimatedDuration ?? 60} min · {t.priority}
                </div>
              </div>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => removeTask(t.id)}>
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={handleDistribute}>
            Distribute all unscheduled tasks
          </button>
        </div>

        <div className="section">
          <h2>Scheduled blocks (Cadence)</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Shown here; add to Google Calendar manually or future auto-sync.
          </p>
          {scheduledForDisplay.length === 0 && <p className="muted">None yet.</p>}
          {scheduledForDisplay.slice(0, 40).map((e) => (
            <div key={e.id} className="scheduled-item">
              <strong>{e.title}</strong>
              <div className="muted">
                {e.start.toLocaleString()} – {e.end.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
