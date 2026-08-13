/** Accept attribute for syllabus upload inputs (kept in sync with the server extractor). */
export const SYLLABUS_UPLOAD_ACCEPT = '.pdf,.docx,.txt,.md';

/**
 * Upload a syllabus file to /api/syllabus/extract and return its plain text.
 * Throws with the server's error message on failure.
 */
export async function extractSyllabusFileText(file: File): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/syllabus/extract', {
    method: 'POST',
    body: formData,
  });
  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok || typeof data.text !== 'string') {
    throw new Error(data.error || `Upload failed: ${res.status}`);
  }
  return data.text;
}
