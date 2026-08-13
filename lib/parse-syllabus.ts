import { formatDateToLocalISO } from '@/lib/date-utils';
import { ollamaChat } from '@/lib/ollama';
import type { OllamaMessage } from '@/lib/ollama';
import { isValidIsoCalendarDate } from '@/lib/decompose-assignment';

export interface SyllabusAssignment {
  title: string;
  description?: string;
  /** YYYY-MM-DD, or undefined if the syllabus didn't give a clear date. */
  dueDate?: string;
}

export interface ParseSyllabusResult {
  assignments: SyllabusAssignment[];
}

/** Same runtime config shape as lib/decompose-assignment.ts. */
export interface ParseSyllabusEnv {
  groqApiKey?: string;
  groqModel?: string;
  openaiApiKey?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  ollamaApiKey?: string;
}

function getProvider(env: ParseSyllabusEnv): 'groq' | 'ollama' | 'openai' {
  if (env.groqApiKey) return 'groq';
  if (env.openaiApiKey) return 'openai';
  return 'ollama';
}

const MAX_SYLLABUS_CHARS = 12_000;

function buildUserPrompt(rawText: string): string {
  const today = formatDateToLocalISO(new Date());
  const trimmed = rawText.slice(0, MAX_SYLLABUS_CHARS);
  return `
You are reading a university course syllabus. Extract every graded assignment,
homework, project, paper, or exam that has (or implies) a deadline.

Today's date is ${today}. The syllabus may give dates as "Week 3", "Sept 5",
"10/10", or a weekday name — infer a concrete YYYY-MM-DD date using today's
date as the anchor for the current term. If a date truly cannot be inferred,
omit dueDate for that item rather than guessing wildly.

Syllabus text:
"""
${trimmed}
"""

Guidelines:
- One entry per gradable deliverable (skip lecture topics, readings with no submission, and policy text).
- Keep titles short and specific (e.g. "Problem Set 3", "Midterm Exam", "Final Project Proposal").
- description: one short line of context from the syllabus if useful (e.g. "Covers chapters 4-6"), otherwise omit.
- Return items in chronological order.

Return ONLY valid JSON with this shape (no markdown, no code fence):
{
  "assignments": [
    { "title": "string", "description": "string", "dueDate": "2026-09-05" }
  ]
}
`;
}

/**
 * Extract gradable assignments + due dates from raw syllabus text.
 * Mirrors the provider selection in decomposeAssignment (Groq > OpenAI > Ollama).
 */
export async function parseSyllabus(
  rawText: string,
  env: ParseSyllabusEnv = {}
): Promise<ParseSyllabusResult> {
  if (!rawText?.trim()) {
    throw new Error('syllabus text is required');
  }

  const provider = getProvider(env);
  const userPrompt = buildUserPrompt(rawText);
  const systemPrompt =
    'You extract structured assignment data from course syllabi. Reply only with valid JSON.';

  let content: string;

  if (provider === 'groq') {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.groqApiKey}`,
      },
      body: JSON.stringify({
        model: env.groqModel || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('Groq API error:', response.status, errorText);
      throw new Error('Failed to call language model.');
    }
    const data = await response.json();
    const msg = data.choices?.[0]?.message?.content;
    if (!msg || typeof msg !== 'string') throw new Error('Unexpected model response format.');
    content = msg;
  } else if (provider === 'ollama') {
    const baseUrlRaw = env.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const baseUrl = baseUrlRaw.startsWith('http') ? baseUrlRaw : `http://${baseUrlRaw}`;
    const model = env.ollamaModel || process.env.OLLAMA_MODEL || 'llama3.2';
    const messages: OllamaMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    content = await ollamaChat(messages, {
      baseUrl,
      model,
      temperature: 0.2,
      stream: false,
      apiKey: env.ollamaApiKey,
    });
  } else {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
      }),
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error('Failed to call language model.');
    }
    const data = await response.json();
    const msg = data.choices?.[0]?.message?.content;
    if (!msg || typeof msg !== 'string') throw new Error('Unexpected model response format.');
    content = msg;
  }

  const trimmedContent = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  let parsed: { assignments?: unknown[] };
  try {
    parsed = JSON.parse(trimmedContent);
  } catch (e) {
    console.error('Failed to parse model JSON:', e, content);
    throw new Error('Model did not return valid JSON.');
  }

  if (!Array.isArray(parsed.assignments)) {
    throw new Error('Model response missing "assignments" array.');
  }

  const cleaned: SyllabusAssignment[] = [];
  for (const item of parsed.assignments) {
    if (!item || typeof item !== 'object') continue;
    const a = item as Record<string, unknown>;
    const title = typeof a.title === 'string' ? a.title.trim() : '';
    if (!title) continue;
    const description = typeof a.description === 'string' ? a.description.trim() || undefined : undefined;
    let dueDate: string | undefined;
    if (typeof a.dueDate === 'string') {
      const candidate = a.dueDate.trim().slice(0, 10);
      if (isValidIsoCalendarDate(candidate)) dueDate = candidate;
    }
    cleaned.push({ title, description, dueDate });
  }

  if (cleaned.length === 0) {
    throw new Error('No assignments found in that syllabus text.');
  }

  return { assignments: cleaned };
}
