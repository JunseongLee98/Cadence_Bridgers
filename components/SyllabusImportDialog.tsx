'use client';

import { useState } from 'react';
import { Task } from '@/types';
import { useI18n } from '@/lib/i18n/context';
import { formatLocalDateForDisplay, parseLocalDateInput } from '@/lib/date-utils';
import { CheckCircle2, GraduationCap, Loader2, X } from 'lucide-react';

/** One syllabus assignment broken into plan-step tasks, ready to schedule. */
export interface SyllabusAssignmentPlan {
  title: string;
  dueIso?: string;
  tasks: Task[];
}

interface SyllabusImportDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Reuses the app's existing AI breakdown (including per-user calibration when
   * signed in with Google) so syllabus steps behave exactly like manually added
   * AI-broken-down tasks.
   */
  createTasksForAssignment: (input: {
    title: string;
    description?: string;
    dueDate?: string;
    category?: string;
    maxSteps?: number;
  }) => Promise<Task[]>;
  /** Called once with every successfully planned assignment; parent adds + schedules. */
  onPlansReady: (plans: SyllabusAssignmentPlan[]) => void;
}

type Phase = 'idle' | 'parsing' | 'planning' | 'error';

interface AssignmentProgress {
  title: string;
  dueDate?: string;
  status: 'pending' | 'planning' | 'done' | 'failed';
  stepCount?: number;
}

export default function SyllabusImportDialog({
  open,
  onClose,
  createTasksForAssignment,
  onPlansReady,
}: SyllabusImportDialogProps) {
  const { m, t, dateLocale } = useI18n();
  const [syllabusText, setSyllabusText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<AssignmentProgress[]>([]);

  const isBusy = phase === 'parsing' || phase === 'planning';

  if (!open) return null;

  const reset = () => {
    setPhase('idle');
    setProgress([]);
    setErrorMessage(null);
  };

  const handleClose = () => {
    if (isBusy) return;
    reset();
    setSyllabusText('');
    onClose();
  };

  const runImport = async () => {
    const text = syllabusText.trim();
    if (!text) return;

    setErrorMessage(null);
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
        throw new Error(err.error || `Request failed: ${parseRes.status}`);
      }
      const { assignments } = (await parseRes.json()) as {
        assignments: { title: string; description?: string; dueDate?: string }[];
      };
      if (!Array.isArray(assignments) || assignments.length === 0) {
        throw new Error(m.syllabus.noAssignments);
      }

      setProgress(
        assignments.map((a) => ({ title: a.title, dueDate: a.dueDate, status: 'pending' as const }))
      );
      setPhase('planning');

      const plans: SyllabusAssignmentPlan[] = [];
      for (let i = 0; i < assignments.length; i++) {
        const assignment = assignments[i];
        setProgress((prev) =>
          prev.map((p, idx) => (idx === i ? { ...p, status: 'planning' } : p))
        );
        try {
          // Fixed small step count — a syllabus import should not interrogate the
          // user per assignment; the AI already sizes steps to the work.
          const tasks = await createTasksForAssignment({
            title: assignment.title,
            description: assignment.description,
            dueDate: assignment.dueDate,
            category: assignment.title,
            maxSteps: 4,
          });
          plans.push({ title: assignment.title, dueIso: assignment.dueDate, tasks });
          setProgress((prev) =>
            prev.map((p, idx) =>
              idx === i ? { ...p, status: 'done', stepCount: tasks.length } : p
            )
          );
        } catch {
          setProgress((prev) =>
            prev.map((p, idx) => (idx === i ? { ...p, status: 'failed' } : p))
          );
        }
      }

      if (plans.length === 0) {
        throw new Error(m.syllabus.noAssignments);
      }

      onPlansReady(plans);
      reset();
      setSyllabusText('');
      onClose();
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Something went wrong.');
      setPhase('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl dark:bg-gray-900">
        <div className="flex items-start justify-between border-b border-gray-200 p-5 dark:border-white/10">
          <div className="flex items-center gap-3">
            <GraduationCap className="h-6 w-6 text-primary-light" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {m.syllabus.title}
              </h2>
              <p className="text-xs text-gray-500 dark:text-white/60">{m.syllabus.subtitle}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isBusy}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40 dark:hover:bg-white/10"
            aria-label={m.common.close}
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          {phase !== 'planning' && (
            <textarea
              value={syllabusText}
              onChange={(e) => setSyllabusText(e.target.value)}
              placeholder={m.syllabus.placeholder}
              rows={9}
              disabled={isBusy}
              className="w-full resize-none rounded-lg border border-gray-300 p-3 text-sm text-gray-800 focus:border-primary-light focus:outline-none disabled:bg-gray-100 dark:border-white/15 dark:bg-white/5 dark:text-white"
            />
          )}

          {progress.length > 0 && (
            <div className="mt-4 space-y-2">
              {progress.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2.5 dark:border-white/10"
                >
                  {p.status === 'done' ? (
                    <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-green-500" />
                  ) : p.status === 'failed' ? (
                    <span
                      className="h-5 w-5 flex-shrink-0 text-center text-red-500"
                      title={m.syllabus.failedItem}
                    >
                      !
                    </span>
                  ) : p.status === 'planning' ? (
                    <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-primary-light" />
                  ) : (
                    <span className="h-5 w-5 flex-shrink-0 rounded-full border-2 border-gray-200 dark:border-white/20" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-white">
                      {p.title}
                    </p>
                    {p.dueDate && (
                      <p className="text-xs text-gray-500 dark:text-white/60">
                        {t('syllabus.due', {
                          date: formatLocalDateForDisplay(
                            parseLocalDateInput(p.dueDate),
                            dateLocale
                          ),
                        })}
                      </p>
                    )}
                  </div>
                  {p.status === 'done' && p.stepCount != null && (
                    <span className="flex-shrink-0 rounded-full bg-primary-light/10 px-2 py-1 text-xs font-medium text-primary-light">
                      {t('syllabus.steps', { count: p.stepCount })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {errorMessage && <p className="mt-3 text-sm text-red-600">{errorMessage}</p>}

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={runImport}
              disabled={isBusy || !syllabusText.trim()}
              className="flex items-center gap-2 rounded-lg bg-primary-light px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-light/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {phase === 'parsing'
                ? m.syllabus.parsing
                : phase === 'planning'
                  ? m.syllabus.planning
                  : m.syllabus.generate}
            </button>
            <button
              onClick={handleClose}
              disabled={isBusy}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-white/15 dark:text-white/80 dark:hover:bg-white/10"
            >
              {m.common.cancel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
