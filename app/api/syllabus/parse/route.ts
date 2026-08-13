import { NextRequest, NextResponse } from 'next/server';
import { parseSyllabus } from '@/lib/parse-syllabus';

/**
 * POST /api/syllabus/parse
 *
 * Prefers Groq when GROQ_API_KEY is set; otherwise OpenAI when OPENAI_API_KEY is set; else Ollama.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { text } = body as { text?: string };

  if (!text?.trim()) {
    return NextResponse.json({ error: 'text is required' }, { status: 400 });
  }

  try {
    const result = await parseSyllabus(text, {
      openaiApiKey: process.env.OPENAI_API_KEY,
      groqApiKey: process.env.GROQ_API_KEY,
      groqModel: process.env.GROQ_MODEL,
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL,
      ollamaModel: process.env.OLLAMA_MODEL,
      ollamaApiKey: process.env.OLLAMA_API_KEY,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error parsing syllabus:', error);
    const message = error instanceof Error ? error.message : 'Failed to parse syllabus.';
    const status =
      message === 'Failed to call language model.' || message.includes('language model')
        ? 502
        : message === 'text is required'
          ? 400
          : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
