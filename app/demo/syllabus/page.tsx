'use client';

import { useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Task, CalendarEvent } from '@/types';
import { CalendarAIAgent } from '@/lib/ai-agent';
import { parseLocalDateInput, formatLocalDateForDisplay } from '@/lib/date-utils';
import { formatMinutesToHoursMinutes } from '@/lib/time-utils';
import Calendar from '@/components/Calendar';
import { Sparkles, CheckCircle2, Loader2, CalendarDays } from 'lucide-react';

const SAMPLE_SYLLABUS = `CS 201: Data Structures & Algorithms — Fall Term

Course schedule and grading:
- Homework 1 (arrays & linked lists) due Sept 5
- Homework 2 (stacks, queues, trees) due Sept 19
- Midterm Exam covering weeks 1-6, held Oct 10
- Homework 3 (graphs & shortest paths) due Oct 24
- Group Project Proposal due Nov 3 — pick a dataset and outline your algorithm
- Group Project Final Submission + writeup due Dec 5
- Final Exam (cumulative) during finals week, Dec 15

Reading chapters are posted weekly on the course site but are not separately graded.`;

type Phase = 'idle' | 'parsing' | 'planning' | 'scheduling' | 'done' | 'error';

interface AssignmentProgress {
  title: string;
  dueDate?: string;
  description?: string;
  status: 'pending' | 'planning' | 'done' | 'failed';
  subtaskCount?: number;
}

export default function SyllabusDemoPage() {
  const [syllabusText, setSyllabusText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<AssignmentProgress[]>([]);
  const [scheduledEvents, setScheduledEvents] = useState<CalendarEvent[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<Task[]>([]);

  const isBusy = phase === 'parsing' || phase === 'planning' || phase === 'scheduling';

  const stats = useMemo(() => {
    if (scheduledEvents.length === 0) return null;
    const totalMinutes = scheduledEvents.reduce(
      (sum, e) => sum + Math.round((e.end.getTime() - e.start.getTime()) / (1000 * 60)),
      0
    );
    const dayKeys = new Set(
      scheduledEvents.map((e) => `${e.start.getFullYear()}-${e.start.getMonth()}-${e.start.getDate()}`)
    );
    const earliest = scheduledEvents.reduce((a, b) => (a.start < b.start ? a : b));
    const latest = scheduledEvents.reduce((a, b) => (a.end > b.end ? a : b));
    return {
      assignmentCount: progress.length,
      sessionCount: scheduledEvents.length,
      totalMinutes,
      dayCount: dayKeys.size,
      earliest: earliest.start,
      latest: latest.end,
    };
  }, [scheduledEvents, progress.length]);

  const runDemo = async () => {
    const text = syllabusText.trim();
    if (!text) return;

    setErrorMessage(null);
    setScheduledEvents([]);
    setScheduledTasks([]);
    setProgress([]);
    setPhase('parsing');

    try {
      const parseRes = await fetch('/api/syllabus/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!parseRes.ok) {
        const err = await parseRes.json().catch(() => ({}));
        throw new Error(err.error || `Syllabus parsing failed: ${parseRes.status}`);
      }
      const { assignments } = (await parseRes.json()) as {
        assignments: { title: string; description?: string; dueDate?: string }[];
      };

      setProgress(assignments.map((a) => ({ ...a, status: 'pending' as const })));
      setPhase('planning');

      const allTasks: Task[] = [];

      for (let i = 0; i < assignments.length; i++) {
        const assignment = assignments[i];
        setProgress((prev) =>
          prev.map((p, idx) => (idx === i ? { ...p, status: 'planning' } : p))
        );

        try {
          const decomposeRes = await fetch('/api/assignments/decompose', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: assignment.title,
              description: assignment.description,
              dueDate: assignment.dueDate,
              locale: 'en',
              maxSteps: 4,
            }),
          });
          if (!decomposeRes.ok) throw new Error('decompose failed');
          const { subtasks } = (await decomposeRes.json()) as {
            subtasks: {
              title: string;
              description?: string;
              dueDate?: string;
              estimatedMinutes?: number;
              workAmount?: number;
              workUnit?: string;
              order: number;
            }[];
          };

          const planId = uuidv4();
          for (const st of subtasks) {
            allTasks.push({
              id: uuidv4(),
              title: st.title,
              description: st.description,
              estimatedDuration: st.estimatedMinutes ?? 60,
              priority: 'medium',
              category: assignment.title,
              dueDate: st.dueDate ? parseLocalDateInput(st.dueDate) : undefined,
              planStepOrder: st.order,
              planId,
              procedureTitle: st.title,
              procedureDescription: st.description,
              ...(st.workAmount !== undefined && st.workUnit
                ? { workAmount: st.workAmount, workUnit: st.workUnit }
                : {}),
              createdAt: new Date(),
              actualDurations: [],
            });
          }

          setProgress((prev) =>
            prev.map((p, idx) =>
              idx === i ? { ...p, status: 'done', subtaskCount: subtasks.length } : p
            )
          );
        } catch {
          setProgress((prev) =>
            prev.map((p, idx) => (idx === i ? { ...p, status: 'failed' } : p))
          );
        }

        // Small stagger so each assignment visibly "lands" instead of all popping at once.
        await new Promise((r) => setTimeout(r, 150));
      }

      if (allTasks.length === 0) {
        throw new Error('No subtasks were generated from this syllabus.');
      }

      setPhase('scheduling');
      const startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      const endDate = CalendarAIAgent.computeScheduleEndDate(allTasks, startDate);
      const events = CalendarAIAgent.distributeTasks(
        allTasks,
        [],
        startDate,
        endDate,
        [{ startHour: 9, endHour: 18 }],
        10,
        50
      );

      setScheduledTasks(allTasks);
      setScheduledEvents(events);
      setPhase('done');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Something went wrong.');
      setPhase('error');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex items-center gap-3">
          <Sparkles className="h-7 w-7 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Syllabus → Schedule</h1>
            <p className="text-sm text-gray-500">
              Paste a syllabus. Cadence finds every assignment, breaks each into work
              sessions, and drops them onto your calendar — no manual entry.
            </p>
          </div>
        </div>

        {phase !== 'done' && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <textarea
              value={syllabusText}
              onChange={(e) => setSyllabusText(e.target.value)}
              placeholder="Paste your course syllabus text here..."
              rows={10}
              disabled={isBusy}
              className="w-full resize-none rounded-lg border border-gray-300 p-3 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none disabled:bg-gray-100"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={runDemo}
                disabled={isBusy || !syllabusText.trim()}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                {phase === 'parsing'
                  ? 'Reading syllabus…'
                  : phase === 'planning'
                    ? 'Planning work sessions…'
                    : phase === 'scheduling'
                      ? 'Scheduling…'
                      : 'Generate My Semester'}
              </button>
              <button
                onClick={() => setSyllabusText(SAMPLE_SYLLABUS)}
                disabled={isBusy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Load sample syllabus
              </button>
            </div>
            {errorMessage && (
              <p className="mt-3 text-sm text-red-600">{errorMessage}</p>
            )}
          </div>
        )}

        {progress.length > 0 && phase !== 'done' && (
          <div className="mt-6 space-y-2">
            {progress.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm transition-opacity duration-300"
              >
                {p.status === 'done' ? (
                  <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-500" />
                ) : p.status === 'failed' ? (
                  <span className="h-5 w-5 flex-shrink-0 text-center text-red-500">!</span>
                ) : p.status === 'planning' ? (
                  <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-indigo-500" />
                ) : (
                  <span className="h-5 w-5 flex-shrink-0 rounded-full border-2 border-gray-200" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{p.title}</p>
                  {p.dueDate && (
                    <p className="text-xs text-gray-500">
                      Due {formatLocalDateForDisplay(parseLocalDateInput(p.dueDate), 'en')}
                    </p>
                  )}
                </div>
                {p.status === 'done' && p.subtaskCount != null && (
                  <span className="flex-shrink-0 rounded-full bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700">
                    {p.subtaskCount} work session{p.subtaskCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {phase === 'done' && stats && (
          <div className="mt-2">
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Assignments found" value={String(stats.assignmentCount)} />
              <StatTile label="Work sessions scheduled" value={String(stats.sessionCount)} />
              <StatTile
                label="Total work time"
                value={formatMinutesToHoursMinutes(stats.totalMinutes)}
              />
              <StatTile label="Spread across" value={`${stats.dayCount} days`} />
            </div>

            <div className="mb-4 flex items-center gap-2 text-sm text-gray-600">
              <CalendarDays className="h-4 w-4" />
              <span>
                {formatLocalDateForDisplay(stats.earliest, 'en')} →{' '}
                {formatLocalDateForDisplay(stats.latest, 'en')}
              </span>
              <button
                onClick={() => {
                  setPhase('idle');
                  setSyllabusText('');
                  setProgress([]);
                  setScheduledEvents([]);
                  setScheduledTasks([]);
                }}
                className="ml-auto rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
              >
                Try another syllabus
              </button>
            </div>

            <div className="h-[600px] rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
              <Calendar events={scheduledEvents} view="week" date={stats.earliest} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 text-center shadow-sm">
      <p className="text-2xl font-bold text-indigo-600">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{label}</p>
    </div>
  );
}
