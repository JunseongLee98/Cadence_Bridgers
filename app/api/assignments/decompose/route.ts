import { NextRequest, NextResponse } from 'next/server';
import {
  clampDecomposeMaxSteps,
  decomposeAssignment,
  normalizeDecomposeMaxSteps,
} from '@/lib/decompose-assignment';

/**
 * POST /api/assignments/decompose
 *
 * Prefers Groq when GROQ_API_KEY is set; otherwise OpenAI when OPENAI_API_KEY is set; else Ollama.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { title, description, dueDate, locale, maxSteps, stepCount } = body as {
    title?: string;
    description?: string;
    dueDate?: string;
    locale?: string;
    maxSteps?: number;
    /** @deprecated use maxSteps */
    stepCount?: number;
  };

  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const normalizedLocale = locale === 'ko' || locale === 'en' ? locale : undefined;

  try {
    const result = await decomposeAssignment(
      {
        title,
        description,
        dueDate,
        locale: normalizedLocale,
        maxSteps: normalizeDecomposeMaxSteps(maxSteps ?? stepCount),
      },
      {
        openaiApiKey: process.env.OPENAI_API_KEY,
        groqApiKey: process.env.GROQ_API_KEY,
        groqModel: process.env.GROQ_MODEL,
        ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
        ollamaModel: process.env.OLLAMA_MODEL,
        ollamaApiKey: process.env.OLLAMA_API_KEY,
      }
    );
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error decomposing assignment:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to decompose assignment.';
    const status =
      message === 'Failed to call language model.' || message.includes('language model')
        ? 502
        : message === 'title is required'
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
