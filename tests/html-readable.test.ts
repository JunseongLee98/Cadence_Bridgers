import { describe, expect, it } from 'vitest';
import { htmlToReadableText, descriptionNeedsCleanup } from '@/lib/html-readable';

describe('htmlToReadableText', () => {
  it('leaves plain text alone', () => {
    expect(htmlToReadableText('Bring notes')).toBe('Bring notes');
  });

  it('converts Canvas-style HTML into readable sections and bullets', () => {
    const html = `
      <h2><strong>Assignment Purpose</strong></h2>
      <p>Your team will produce a <strong>Product Vision</strong>.</p>
      <ul><li>synthesize research</li><li>articulate a vision</li></ul>
      <p><a href="https://example.com/doc" target="_blank">Example deliverable</a></p>
    `;
    const text = htmlToReadableText(html);
    expect(text).toContain('Assignment Purpose');
    expect(text).toContain('Your team will produce a Product Vision.');
    expect(text).toContain('• synthesize research');
    expect(text).toContain('• articulate a vision');
    expect(text).toContain('Example deliverable (https://example.com/doc)');
    expect(text).not.toContain('<h2>');
    expect(text).not.toContain('<strong>');
  });

  it('handles empty input', () => {
    expect(htmlToReadableText('')).toBe('');
    expect(htmlToReadableText(null)).toBe('');
  });
});

describe('descriptionNeedsCleanup', () => {
  it('detects markup', () => {
    expect(descriptionNeedsCleanup('<p>Hi</p>')).toBe(true);
    expect(descriptionNeedsCleanup('Hi')).toBe(false);
  });
});
