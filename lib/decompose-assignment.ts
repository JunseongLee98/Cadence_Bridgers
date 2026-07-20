import { formatDateToLocalISO, parseLocalDateInput } from '@/lib/date-utils';
import { ollamaChat } from '@/lib/ollama';
import type { OllamaMessage } from '@/lib/ollama';

export interface DecomposeInput {
  title: string;
  description?: string;
  dueDate?: string;
  /** Target number of subtasks (2–8). Omit for automatic count. */
  stepCount?: number;
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

/** Clamp user step count to a safe range for prompts and validation. */
export function normalizeDecomposeStepCount(stepCount?: number): number | undefined {
  if (stepCount === undefined || stepCount === null) return undefined;
  if (!Number.isFinite(stepCount)) return undefined;
  const n = Math.round(stepCount);
  if (n < 2 || n > 8) return undefined;
  return n;
}

/** Exported for unit tests that assert decompose prompt policy. */
export function buildStepCountGuideline(stepCount?: number): string {
  const normalized = normalizeDecomposeStepCount(stepCount);
  if (normalized === undefined) {
    return [
      '- Prefer 2–4 subtasks. Use at most 5 only when the assignment is clearly large or multi-part. Never invent busywork to reach a count; never use 6+ steps for a simple or short task.',
      '- Keep steps coarse and practical (e.g. "Read and annotate the chapter", "Draft the essay", "Revise and submit") — do NOT over-split into tiny pieces like separate outline / intro / body / conclusion / cite / proofread unless the assignment is long enough that those are real sessions.',
      '- Combine related work into one step when it would normally be done together in a single sitting.',
    ].join('\n');
  }
  return [
    `- Create exactly ${normalized} subtasks (no more, no fewer).`,
    '- Keep each step a meaningful work block a student can schedule in one or a few sittings.',
    '- Combine related work when needed to hit the count without inventing busywork.',
  ].join('\n');
}

function buildDueDateGuideline(assignmentDue?: string): string {
  const today = formatDateToLocalISO(new Date());
  const dueLine = assignmentDue
    ? `- The assignment is due ${assignmentDue.includes('T') ? assignmentDue.slice(0, 10) : assignmentDue}; the final subtask must have dueDate on or before that day.`
    : '- No assignment due date was given; spread subtask due dates across the next 7–14 days starting from today.';
  return [
    '- Assign each subtask a "dueDate" (YYYY-MM-DD): the calendar day that step should be finished by.',
    `- Today is ${today}. Earlier steps get earlier due dates; keep due dates in non-decreasing order by step order.`,
    dueLine,
  ].join('\n');
}

/** Fill missing per-step due dates by spreading from today through the assignment due date. */
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
    end.setDate(end.getDate() + 14);
  }
  if (end.getTime() < today.getTime()) {
    end = new Date(today);
  }

  const n = subtasks.length;
  return subtasks.map((st, i) => {
    if (st.dueDate && isValidIsoCalendarDate(st.dueDate)) return st;
    if (n === 1) {
      return { ...st, dueDate: formatDateToLocalISO(end) };
    }
    const t = i / (n - 1);
    const ms = today.getTime() + t * (end.getTime() - today.getTime());
    return { ...st, dueDate: formatDateToLocalISO(new Date(ms)) };
  });
}

function buildUserPrompt(input: DecomposeInput): string {
  const { title, description, dueDate, locale, stepCount } = input;
  return `
You are an expert study-planning assistant for university students.

Given an assignment, break it into a short sequence of meaningful work blocks a student can schedule — not a micro checklist.

Assignment:
- Title: ${title}
- Due date: ${dueDate ?? 'not specified'}
- Description (may be from Canvas): ${description ?? 'none'}

Guidelines:
${buildStepCountGuideline(stepCount)}
- Include a rough estimated duration in minutes for each subtask (e.g. 45, 60, 90, 120). Longer steps are fine; prefer fewer longer blocks over many 30–45 minute crumbs.
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
        'You are a helpful study planner. Prefer fewer, coarser work blocks over many tiny steps. Reply only with valid JSON.',
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
          { role: 'system', content: 'You are a helpful study planner that returns strict JSON. Prefer 2–4 coarser work blocks; avoid over-splitting simple tasks.' },
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
          { role: 'system', content: 'You are a helpful study planner that returns strict JSON. Prefer 2–4 coarser work blocks; avoid over-splitting simple tasks.' },
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

  const withDueDates = ensureSubtaskDueDates(cleaned, input.dueDate);
  return { subtasks: withDueDates };
}
