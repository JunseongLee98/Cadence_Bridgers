'use client';

import { useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Task, CalendarEvent } from '@/types';
import { CalendarAIAgent, leadDaysForWorkload } from '@/lib/ai-agent';
import {
  parseLocalDateInput,
  formatLocalDateForDisplay,
  endOfLocalCalendarDay,
} from '@/lib/date-utils';
import { formatMinutesToHoursMinutes } from '@/lib/time-utils';
import Calendar from '@/components/Calendar';
import {
  extractSyllabusFileText,
  SYLLABUS_UPLOAD_ACCEPT,
} from '@/lib/syllabus-upload-client';
import { Sparkles, CheckCircle2, Loader2, CalendarDays, ListChecks, Upload } from 'lucide-react';

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

interface SuggestedStep {
  title: string;
  estimatedMinutes: number;
  /** Soft "finish by" suggestion (latest suggested session day, else the due date). */
  finishBy?: Date;
  scheduled: boolean;
}

interface AssignmentPlan {
  title: string;
  dueDate?: Date;
  totalMinutes: number;
  steps: SuggestedStep[];
}

export default function SyllabusDemoPage() {
  const [syllabusText, setSyllabusText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<AssignmentProgress[]>([]);
  const [scheduledEvents, setScheduledEvents] = useState<CalendarEvent[]>([]);
  const [assignmentPlans, setAssignmentPlans] = useState<AssignmentPlan[]>([]);
  const [includeSaturday, setIncludeSaturday] = useState(false);
  const [includeSunday, setIncludeSunday] = useState(false);
  const [resultTab, setResultTab] = useState<'plan' | 'calendar'>('plan');
  const [isExtracting, setIsExtracting] = useState(false);
  const [uploadedName, setUploadedName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isBusy =
    phase === 'parsing' || phase === 'planning' || phase === 'scheduling' || isExtracting;

  const handleFile = async (file: File | undefined | null) => {
    if (!file || isBusy) return;
    setErrorMessage(null);
    setUploadedName(null);
    setIsExtracting(true);
    try {
      const text = await extractSyllabusFileText(file);
      setSyllabusText(text);
      setUploadedName(file.name);
      if (phase === 'error') setPhase('idle');
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Failed to read the file.');
    } finally {
      setIsExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

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
      assignmentCount: assignmentPlans.length,
      sessionCount: scheduledEvents.length,
      totalMinutes,
      dayCount: dayKeys.size,
      earliest: earliest.start,
      latest: latest.end,
    };
  }, [scheduledEvents, assignmentPlans.length]);

  const runDemo = async () => {
    const text = syllabusText.trim();
    if (!text) return;

    setErrorMessage(null);
    setScheduledEvents([]);
    setAssignmentPlans([]);
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

      // Decompose each assignment into steps, keeping tasks grouped per assignment.
      const perAssignment: {
        title: string;
        dueDate?: string;
        tasks: Task[];
      }[] = [];

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
          const tasks: Task[] = subtasks.map((st) => ({
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
          }));

          perAssignment.push({ title: assignment.title, dueDate: assignment.dueDate, tasks });
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

      if (perAssignment.every((a) => a.tasks.length === 0)) {
        throw new Error('No subtasks were generated from this syllabus.');
      }

      setPhase('scheduling');

      const scheduleDays = [
        1, 2, 3, 4, 5,
        ...(includeSaturday ? [6] : []),
        ...(includeSunday ? [0] : []),
      ];
      const workSegments = [{ startHour: 9, endHour: 18 }];
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Earlier due dates get first pick of calendar slots; undated work goes last.
      const ordered = [...perAssignment].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });

      let existing: CalendarEvent[] = [];
      const allEvents: CalendarEvent[] = [];
      const plans: AssignmentPlan[] = [];

      for (const assignment of ordered) {
        if (assignment.tasks.length === 0) continue;
        const totalMinutes = assignment.tasks.reduce(
          (sum, t) => sum + (t.estimatedDuration ?? 60),
          0
        );

        // Anchor each assignment's window backward from ITS due date — an empty
        // week months before the due date is not a reason to start early.
        let windowStart = today;
        let windowEnd: Date;
        if (assignment.dueDate) {
          const dueDay = parseLocalDateInput(assignment.dueDate);
          const start = new Date(dueDay);
          start.setDate(start.getDate() - leadDaysForWorkload(totalMinutes));
          windowStart = start.getTime() > today.getTime() ? start : today;
          windowEnd = endOfLocalCalendarDay(dueDay);
          if (windowEnd.getTime() < today.getTime()) {
            // Past-due syllabus item (mid-term import): suggest ASAP this week.
            windowStart = today;
            windowEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
          }
        } else {
          windowEnd = CalendarAIAgent.computeScheduleEndDate(assignment.tasks, today);
        }

        const events = CalendarAIAgent.distributeTasks(
          assignment.tasks,
          existing,
          windowStart,
          windowEnd,
          workSegments,
          10,
          50,
          scheduleDays
        );
        existing = [...existing, ...events];
        allEvents.push(...events);

        const dueDate = assignment.dueDate ? parseLocalDateInput(assignment.dueDate) : undefined;
        const orderedTasks = [...assignment.tasks].sort(
          (a, b) => (a.planStepOrder ?? 0) - (b.planStepOrder ?? 0)
        );
        plans.push({
          title: assignment.title,
          dueDate,
          totalMinutes,
          steps: orderedTasks.map((task) => {
            const blocks = events.filter((e) => e.taskId === task.id);
            const lastBlock =
              blocks.length > 0
                ? blocks.reduce((a, b) => (a.start > b.start ? a : b))
                : null;
            return {
              title: task.title,
              estimatedMinutes: task.estimatedDuration ?? 60,
              finishBy: lastBlock ? lastBlock.start : dueDate,
              scheduled: blocks.length > 0,
            };
          }),
        });
      }

      // Present plans in due-date order (they were scheduled in that order too).
      setAssignmentPlans(plans);
      setScheduledEvents(allEvents);
      setResultTab('plan');
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
            <h1 className="text-2xl font-bold text-gray-900">Syllabus → Study Plan</h1>
            <p className="text-sm text-gray-500">
              Paste a syllabus. Cadence finds every assignment, suggests a step-by-step
              plan for each with soft &ldquo;finish by&rdquo; dates, and sketches the work near each
              real due date — not crammed into week one.
            </p>
          </div>
        </div>

        {phase !== 'done' && (
          <div
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void handleFile(e.dataTransfer.files?.[0]);
            }}
          >
            <textarea
              value={syllabusText}
              onChange={(e) => setSyllabusText(e.target.value)}
              placeholder="Paste your course syllabus text here, or drop a PDF/DOCX file anywhere in this box..."
              rows={10}
              disabled={isBusy}
              className="w-full resize-none rounded-lg border border-gray-300 p-3 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none disabled:bg-gray-100"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept={SYLLABUS_UPLOAD_ACCEPT}
                onChange={(e) => void handleFile(e.target.files?.[0])}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isBusy}
                className="flex items-center gap-2 rounded-lg border border-dashed border-gray-400 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {isExtracting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Upload file (PDF, DOCX, TXT)
              </button>
              {uploadedName && !isExtracting && (
                <span className="text-xs text-green-700">
                  Loaded from {uploadedName} — review and edit before generating.
                </span>
              )}
            </div>
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
                    ? 'Planning steps…'
                    : phase === 'scheduling'
                      ? 'Suggesting sessions…'
                      : 'Generate My Semester'}
              </button>
              <button
                onClick={() => setSyllabusText(SAMPLE_SYLLABUS)}
                disabled={isBusy}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Load sample syllabus
              </button>
              <div className="ml-auto flex items-center gap-4 text-sm text-gray-700">
                <span className="text-gray-500">Weekend study:</span>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={includeSaturday}
                    onChange={(e) => setIncludeSaturday(e.target.checked)}
                    disabled={isBusy}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Sat
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={includeSunday}
                    onChange={(e) => setIncludeSunday(e.target.checked)}
                    disabled={isBusy}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  Sun
                </label>
              </div>
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
                    {p.subtaskCount} step{p.subtaskCount === 1 ? '' : 's'}
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
              <StatTile label="Suggested sessions" value={String(stats.sessionCount)} />
              <StatTile
                label="Total study time"
                value={formatMinutesToHoursMinutes(stats.totalMinutes)}
              />
              <StatTile label="Spread across" value={`${stats.dayCount} days`} />
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-gray-600">
              <CalendarDays className="h-4 w-4" />
              <span>
                {formatLocalDateForDisplay(stats.earliest, 'en')} →{' '}
                {formatLocalDateForDisplay(stats.latest, 'en')}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <div className="flex overflow-hidden rounded-lg border border-gray-300 text-xs font-medium">
                  <button
                    onClick={() => setResultTab('plan')}
                    className={`flex items-center gap-1 px-3 py-1.5 ${
                      resultTab === 'plan'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <ListChecks className="h-3.5 w-3.5" /> Study plan
                  </button>
                  <button
                    onClick={() => setResultTab('calendar')}
                    className={`flex items-center gap-1 px-3 py-1.5 ${
                      resultTab === 'calendar'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    <CalendarDays className="h-3.5 w-3.5" /> Calendar
                  </button>
                </div>
                <button
                  onClick={() => {
                    setPhase('idle');
                    setSyllabusText('');
                    setProgress([]);
                    setScheduledEvents([]);
                    setAssignmentPlans([]);
                    setUploadedName(null);
                  }}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  Try another syllabus
                </button>
              </div>
            </div>

            {resultTab === 'plan' && (
              <div className="space-y-4">
                <p className="text-xs text-gray-500">
                  These are suggestions, not appointments — each step shows roughly how long
                  it takes and a soft &ldquo;finish by&rdquo; date that keeps you on pace for the real
                  deadline. Work starts near each due date, when the assignment is
                  realistically available.
                </p>
                {assignmentPlans.map((plan, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">{plan.title}</h3>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-gray-500">
                          ~{formatMinutesToHoursMinutes(plan.totalMinutes)} total
                        </span>
                        {plan.dueDate && (
                          <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">
                            Due {formatLocalDateForDisplay(plan.dueDate, 'en')}
                          </span>
                        )}
                      </div>
                    </div>
                    <ol className="space-y-2">
                      {plan.steps.map((step, j) => (
                        <li key={j} className="flex items-start gap-3 text-sm">
                          <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">
                            {j + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-gray-800">{step.title}</p>
                            <p className="text-xs text-gray-500">
                              ~{formatMinutesToHoursMinutes(step.estimatedMinutes)}
                              {step.finishBy && (
                                <>
                                  {' · '}
                                  <span className={step.scheduled ? '' : 'text-amber-600'}>
                                    finish by {formatLocalDateForDisplay(step.finishBy, 'en')}
                                    {!step.scheduled && ' (no free slot found — plan manually)'}
                                  </span>
                                </>
                              )}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            )}

            {resultTab === 'calendar' && (
              <div className="h-[600px] rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
                <Calendar events={scheduledEvents} view="month" date={stats.earliest} />
              </div>
            )}
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
