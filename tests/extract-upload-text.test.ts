import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractSyllabusTextFromUpload } from '@/lib/extract-upload-text';

const FIXTURES = join(__dirname, 'fixtures');

describe('extractSyllabusTextFromUpload', () => {
  it('extracts text from a PDF and strips page markers', async () => {
    const buffer = readFileSync(join(FIXTURES, 'sample-syllabus.pdf'));
    const text = await extractSyllabusTextFromUpload('syllabus.pdf', buffer);
    expect(text).toContain('Homework 1 due Sept 5');
    expect(text).not.toMatch(/-- \d+ of \d+ --/);
  });

  it('extracts text from a DOCX', async () => {
    const buffer = readFileSync(join(FIXTURES, 'sample-syllabus.docx'));
    const text = await extractSyllabusTextFromUpload('syllabus.docx', buffer);
    expect(text).toContain('Midterm Oct 10');
  });

  it('passes plain text through', async () => {
    const text = await extractSyllabusTextFromUpload(
      'notes.txt',
      Buffer.from('  HW due Friday  \n')
    );
    expect(text).toBe('HW due Friday');
  });

  it('rejects unsupported extensions', async () => {
    await expect(
      extractSyllabusTextFromUpload('old.doc', Buffer.from('x'))
    ).rejects.toThrow(/Unsupported file type/);
  });
});
