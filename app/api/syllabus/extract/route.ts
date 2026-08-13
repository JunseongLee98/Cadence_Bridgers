import { NextRequest, NextResponse } from 'next/server';
import {
  extractSyllabusTextFromUpload,
  MAX_SYLLABUS_UPLOAD_BYTES,
} from '@/lib/extract-upload-text';

/**
 * POST /api/syllabus/extract
 *
 * Accepts multipart/form-data with a "file" field (PDF, DOCX, TXT, MD) and
 * returns the extracted plain text, ready for /api/syllabus/parse.
 */
export async function POST(request: NextRequest) {
  let file: File;
  try {
    const formData = await request.formData();
    const entry = formData.get('file');
    if (!(entry instanceof File)) {
      return NextResponse.json({ error: 'file field is required' }, { status: 400 });
    }
    file = entry;
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 });
  }

  if (file.size > MAX_SYLLABUS_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${Math.round(MAX_SYLLABUS_UPLOAD_BYTES / 1024 / 1024)}MB).` },
      { status: 413 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractSyllabusTextFromUpload(file.name, buffer);
    if (!text) {
      return NextResponse.json(
        {
          error:
            'No text found in this file. Scanned/image-only PDFs are not supported — paste the text instead.',
        },
        { status: 422 }
      );
    }
    return NextResponse.json({ text });
  } catch (error) {
    console.error('Error extracting syllabus upload:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to read the uploaded file.';
    const status = message.startsWith('Unsupported file type') ? 415 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
