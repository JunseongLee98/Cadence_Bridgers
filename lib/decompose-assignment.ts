import { formatDateToLocalISO, parseLocalDateInput } from '@/lib/date-utils';
import { ollamaChat } from '@/lib/ollama';
import type { OllamaMessage } from '@/lib/ollama';

export interface DecomposeInput {
  title: string;
  description?: string;
  dueDate?: string;
  /** Maximum subtasks the model may return (2–10). Omit for default planning rules. */
  maxSteps?: number;
  /** App UI locale — subtask titles/descriptions should be written in this language. */
  locale?: 'en' | 'ko';
}

export interface DecomposeSubtask {
  title: string;
  description?: string;
  /** Suggested finish-by date for this step (`YYYY-MM-DD`, local calendar day). */
  dueDate?: string;
  estimatedMinutes?: number;
  /** AI-inferred measurable quantity for this step (e.g. 20). */
  workAmount?: number;
  /** AI-chosen unit label (e.g. "pages", "questions", "words"). */
  workUnit?: string;
  order: number;
}

const WORK_UNIT_MAX_LEN = 40;
const WORK_AMOUNT_MAX = 1_000_000;

/** Normalize a freeform work unit label (trim, lowercase, length cap). */
export function normalizeWorkUnit(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return undefined;
  return normalized.slice(0, WORK_UNIT_MAX_LEN);
}

/**
 * Parse optional workAmount + workUnit from model output.
 * Both must be valid together; otherwise both are omitted.
 */
export function sanitizeWorkFields(raw: {
  workAmount?: unknown;
  workUnit?: unknown;
}): { workAmount?: number; workUnit?: string } {
  const workUnit = normalizeWorkUnit(raw.workUnit);
  let amount: number | undefined;
  if (typeof raw.workAmount === 'number' && Number.isFinite(raw.workAmount)) {
    amount = raw.workAmount;
  } else if (typeof raw.workAmount === 'string' && raw.workAmount.trim()) {
    const parsed = Number(raw.workAmount);
    if (Number.isFinite(parsed)) amount = parsed;
  }
  if (amount === undefined || workUnit === undefined) return {};
  if (amount <= 0) return {};
  const workAmount = Math.min(WORK_AMOUNT_MAX, Math.round(amount * 100) / 100);
  if (workAmount <= 0) return {};
  return { workAmount, workUnit };
}

export interface DecomposeResult {
  subtasks: DecomposeSubtask[];
}

/** Runtime config for LLM (env vars in Node, chrome.storage in extension). */
export interface DecomposeEnv {
  groqApiKey?: string;
  groqModel?: string;
  openaiApiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaApiKey?: string;
}

function getProvider(env: DecomposeEnv): 'groq' | 'ollama' | 'openai' {
  if (env.groqApiKey && env.groqApiKey !== '') {
    return 'groq';
  }
  if (env.openaiApiKey && env.openaiApiKey !== '') {
    return 'openai';
  }
  return 'ollama';
}

/** Language rule injected into the decompose prompt. */
export function decomposeLanguageInstruction(locale?: string): string {
  if (locale === 'ko') {
    return [
      '- Language: Write every subtask "title" and "description" in Korean (한국어).',
      '- Keep JSON keys in English. workUnit may be Korean when that fits the assignment (e.g. "페이지", "문제").',
      '- Do not translate the assignment into English; plan steps must be Korean.',
    ].join('\n');
  }
  if (locale === 'en') {
    return [
      '- Language: Write every subtask "title" and "description" in English.',
      '- Keep JSON keys in English. workUnit should be a short English label when possible.',
    ].join('\n');
  }
  return [
    '- Language: Write every subtask "title" and "description" in the same language as the assignment title/description.',
    '- If the assignment is in Korean, use Korean; if in English, use English.',
    '- Keep JSON keys in English.',
  ].join('\n');
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoCalendarDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = parseLocalDateInput(value);
  return !Number.isNaN(d.getTime());
}

const DEFAULT_MAX_STEPS = 4;

/** Minimum subtasks the user may allow (also used when clamping). */
export const DECOMPOSE_MIN_MAX_STEPS = 2;

/** Last value in the preset dropdown (2…N). Custom input may go higher. */
export const DECOMPOSE_PRESET_MAX_STEPS = 10;

/** Upper bound for custom max-step input (prompt size / runaway model output). */
export const DECOMPOSE_ABS_MAX_STEPS = 50;

export const AI_DECOMPOSE_STEP_PRESETS: number[] = Array.from(
  { length: DECOMPOSE_PRESET_MAX_STEPS - DECOMPOSE_MIN_MAX_STEPS + 1 },
  (_, i) => DECOMPOSE_MIN_MAX_STEPS + i
);

/** Clamp user max-step setting to a safe range for prompts and validation. */
export function normalizeDecomposeMaxSteps(maxSteps?: number): number | undefined {
  if (maxSteps === undefined || maxSteps === null) return undefined;
  if (!Number.isFinite(maxSteps)) return undefined;
  const n = Math.round(maxSteps);
  if (n < DECOMPOSE_MIN_MAX_STEPS || n > DECOMPOSE_ABS_MAX_STEPS) return undefined;
  return n;
}

/** Clamp a raw UI value to the allowed max-steps range. */
export function clampDecomposeMaxSteps(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_STEPS;
  const n = Math.round(value);
  return Math.min(DECOMPOSE_ABS_MAX_STEPS, Math.max(DECOMPOSE_MIN_MAX_STEPS, n));
}

/** @deprecated Use normalizeDecomposeMaxSteps */
export function normalizeDecomposeStepCount(stepCount?: number): number | undefined {
  return normalizeDecomposeMaxSteps(stepCount);
}

/** Trim excess subtasks if the model exceeded the user's maximum. */
export function capDecomposeSubtasks(
  subtasks: DecomposeSubtask[],
  maxSteps?: number
): DecomposeSubtask[] {
  const max = normalizeDecomposeMaxSteps(maxSteps);
  if (!max || subtasks.length <= max) return subtasks;
  return subtasks.slice(0, max).map((st, i) => ({ ...st, order: i + 1 }));
}

/** Exported for unit tests that assert decompose prompt policy. */
export function buildStepCountGuideline(maxSteps?: number): string {
  const normalized = normalizeDecomposeMaxSteps(maxSteps) ?? DEFAULT_MAX_STEPS;
  return [
    `- Use at most ${normalized} subtasks. Prefer 2–3 for ordinary homework; never exceed ${normalized}.`,
    '- Assume a capable university student: do not over-specify or micro-manage (no separate outline/intro/body/conclusion/cite/proofread steps unless the assignment is clearly a large multi-day project).',
    '- Keep steps coarse and practical (e.g. "Read and annotate the chapter", "Draft the essay", "Revise and submit"). Combine related work that fits in one sitting.',
    '- Never invent busywork to approach the maximum; fewer meaningful blocks are better than a detailed checklist.',
  ].join('\n');
}

function buildDueDateGuideline(assignmentDue?: string): string {
  const today = formatDateToLocalISO(new Date());
  const dueLine = assignmentDue
    ? `- The assignment is due ${assignmentDue.includes('T') ? assignmentDue.slice(0, 10) : assignmentDue}; the final subtask must have dueDate on or before that day.`
    : '- No assignment due date was given; keep due dates tight (finish within a few days for short work — do not invent a multi-week timeline).';
  return [
    '- Assign each subtask a "dueDate" (YYYY-MM-DD): the calendar day that step should be finished by (a deadline, not a schedule-on date).',
    `- Today is ${today}. Earlier steps get earlier due dates; keep due dates in non-decreasing order by step order.`,
    '- Match the timeline to the work: a few hours of total effort should finish within 1–3 days, not a full week.',
    dueLine,
  ].join('\n');
}

/** Fill missing per-step due dates with a compact horizon based on estimates. */
export function ensureSubtaskDueDates(
  subtasks: DecomposeSubtask[],
  assignmentDueIso?: string
): DecomposeSubtask[] {
  if (subtasks.length === 0) return subtasks;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let end = new Date(today);
  if (assignmentDueIso) {
    const datePart = assignmentDueIso.includes('T')
      ? formatDateToLocalISO(new Date(assignmentDueIso))
      : assignmentDueIso.slice(0, 10);
    if (isValidIsoCalendarDate(datePart)) {
      end = parseLocalDateInput(datePart);
    }
  } else {
    const totalMinutes = subtasks.reduce(
      (sum, st) => sum + (st.estimatedMinutes && st.estimatedMinutes > 0 ? st.estimatedMinutes : 60),
      0
    );
    // ~6h productive day; keep short plans within a few calendar days (cap 14).
    const workDays = Math.max(1, Math.ceil(totalMinutes / (6 * 60)));
    const span = Math.min(14, Math.max(workDays, Math.min(subtasks.length, 3)) - 1);
    end.setDate(end.getDate() + Math.max(0, span));
  }
  if (end.getTime() < today.getTime()) {
    end = new Date(today);
  }

  const n = subtasks.length;
  return subtasks.map((st, i) => {
    if (st.dueDate && isValidIsoCalendarDate(st.dueDate)) {
      const parsed = parseLocalDateInput(st.dueDate);
      if (parsed.getTime() < today.getTime()) {
        return { ...st, dueDate: formatDateToLocalISO(today) };
      }
      return st;
    }
    if (n === 1) {
      return { ...st, dueDate: formatDateToLocalISO(end) };
    }
    const t = i / (n - 1);
    const ms = today.getTime() + t * (end.getTime() - today.getTime());
    return { ...st, dueDate: formatDateToLocalISO(new Date(ms)) };
  });
}

function buildUserPrompt(input: DecomposeInput): string {
  const { title, description, dueDate, locale, maxSteps } = input;
  return `
You are an expert study-planning assistant for university students.

Given an assignment, break it into a short sequence of meaningful work blocks a student can schedule — not a micro checklist. Respect that students can handle substantial chunks of work without hand-holding.

Assignment:
- Title: ${title}
- Due date: ${dueDate ?? 'not specified'}
- Description (may be from Canvas): ${description ?? 'none'}

Guidelines:
${buildStepCountGuideline(maxSteps)}
- Include a rough estimated duration in minutes for each subtask (e.g. 45, 60, 90, 120). Prefer realistic longer blocks; do not pad with many short 30–45 minute crumbs.
- Keep step titles/descriptions brief and action-oriented — avoid long procedural instructions inside each step.
- Order the subtasks in a sensible sequence from 1..N.
${buildDueDateGuideline(dueDate)}
- When the work is measurable, include workAmount (positive number) and workUnit (short freeform label you choose from the assignment, e.g. pages/questions/words or the equivalent in the output language). Do not invent a fixed global unit system—pick whatever unit fits that step.
- Omit workAmount and workUnit when the step is not quantifiable (e.g. brainstorming ideas, reviewing feedback).
${decomposeLanguageInstruction(locale)}

Return ONLY valid JSON with this shape (no markdown, no code fence):
{
  "subtasks": [
    {
      "title": "string",
      "description": "string",
      "dueDate": "2026-07-10",
      "estimatedMinutes": 60,
      "workAmount": 20,
      "workUnit": "pages",
      "order": 1
    }
  ]
}
`;
}

/** Exported for unit tests that assert decompose prompt policy. */
export function buildDecomposeUserPrompt(input: DecomposeInput): string {
  return buildUserPrompt(input);
}

/**
 * Core assignment decomposition used by the Next.js API route and the Chrome extension background.
 */
export async function decomposeAssignment(
  input: DecomposeInput,
  env: DecomposeEnv = {}
): Promise<DecomposeResult> {
  if (!input.title?.trim()) {
    throw new Error('title is required');
  }

  const provider = getProvider(env);
  const userPrompt = buildUserPrompt(input);

  const messages: OllamaMessage[] = [
    {
      role: 'system',
      content:
        'You are a helpful study planner for capable university students. Prefer fewer, coarser work blocks; do not micro-manage. Reply only with valid JSON.',
    },
    { role: 'user', content: userPrompt },
  ];

  let content: string;

  if (provider === 'groq') {
    const key = env.groqApiKey!;
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model:
          env.groqModel ||
          (typeof process !== 'undefined' ? process.env?.GROQ_MODEL : undefined) ||
          'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a helpful study planner that returns strict JSON. Prefer 2–3 coarser blocks for ordinary homework; avoid over-specifying or underestimating students.' },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('Groq API error:', response.status, errorText);
      throw new Error('Failed to call language model.');
    }

    const data = await response.json();
    const msg = data.choices?.[0]?.message?.content;
    if (!msg || typeof msg !== 'string') {
      throw new Error('Unexpected model response format.');
    }
    content = msg;
  } else if (provider === 'ollama') {
    const baseUrlRaw =
      env.ollamaBaseUrl && env.ollamaBaseUrl !== ''
        ? env.ollamaBaseUrl
        : typeof process !== 'undefined' && process.env?.OLLAMA_BASE_URL
          ? process.env.OLLAMA_BASE_URL
          : 'http://localhost:11434';
    const baseUrl = baseUrlRaw.startsWith('http') ? baseUrlRaw : `http://${baseUrlRaw}`;
    const model =
      env.ollamaModel ||
      (typeof process !== 'undefined' ? process.env?.OLLAMA_MODEL : undefined) ||
      'llama3.2';

    content = await ollamaChat(messages, {
      baseUrl,
      model,
      temperature: 0.3,
      stream: false,
      apiKey: env.ollamaApiKey,
    });
  } else {
    const key = env.openaiApiKey!;
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: 'You are a helpful study planner that returns strict JSON. Prefer 2–3 coarser blocks for ordinary homework; avoid over-specifying or underestimating students.' },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error('Failed to call language model.');
    }

    const data = await response.json();
    const msg = data.choices?.[0]?.message?.content;
    if (!msg || typeof msg !== 'string') {
      throw new Error('Unexpected model response format.');
    }
    content = msg;
  }

  const trimmed = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed: { subtasks?: unknown[] };
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    console.error('Failed to parse model JSON:', e, content);
    throw new Error('Model did not return valid JSON.');
  }

  if (!Array.isArray(parsed.subtasks)) {
    throw new Error('Model response missing "subtasks" array.');
  }

  const raw = parsed.subtasks as unknown[];
  const cleaned: DecomposeSubtask[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const st = item as Record<string, unknown>;
    const title = typeof st.title === 'string' ? st.title.trim() : '';
    if (!title) continue;
    const description =
      typeof st.description === 'string' ? st.description : undefined;
    let estimatedMinutes: number | undefined;
    if (typeof st.estimatedMinutes === 'number' && Number.isFinite(st.estimatedMinutes)) {
      estimatedMinutes = Math.max(15, Math.round(st.estimatedMinutes));
    }
    const work = sanitizeWorkFields({
      workAmount: st.workAmount,
      workUnit: st.workUnit,
    });
    let dueDate: string | undefined;
    if (typeof st.dueDate === 'string') {
      const candidate = st.dueDate.trim().slice(0, 10);
      if (isValidIsoCalendarDate(candidate)) {
        dueDate = candidate;
      }
    }
    cleaned.push({
      title,
      description,
      dueDate,
      estimatedMinutes,
      ...work,
      order: cleaned.length + 1,
    });
  }

  if (cleaned.length === 0) {
    throw new Error('Model returned no usable subtasks (missing titles).');
  }

  const capped = capDecomposeSubtasks(cleaned, input.maxSteps);
  const withDueDates = ensureSubtaskDueDates(capped, input.dueDate);
  return { subtasks: withDueDates };
}
