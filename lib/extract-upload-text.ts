import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';

/** File types the syllabus upload accepts (legacy binary .doc is not parseable here). */
export const SYLLABUS_UPLOAD_ACCEPT = '.pdf,.docx,.txt,.md';

export const MAX_SYLLABUS_UPLOAD_BYTES = 8 * 1024 * 1024;

/** pdf-parse inserts "-- N of M --" page separators; they are noise for the LLM. */
function stripPdfPageMarkers(text: string): string {
  return text.replace(/^\s*-- \d+ of \d+ --\s*$/gm, '');
}

/**
 * Extract plain text from an uploaded syllabus file (server-side).
 * Supports PDF (text-based), DOCX, and plain-text formats.
 */
export async function extractSyllabusTextFromUpload(
  filename: string,
  buffer: Buffer
): Promise<string> {
  const ext = (filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '') as string;

  if (ext === '.pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return stripPdfPageMarkers(result.text ?? '').trim();
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return (result.value ?? '').trim();
  }

  if (ext === '.txt' || ext === '.md' || ext === '') {
    return buffer.toString('utf8').trim();
  }

  throw new Error(
    `Unsupported file type "${ext}". Supported: PDF, DOCX, TXT, MD.`
  );
}
