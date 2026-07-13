/**
 * Convert HTML-ish calendar/Canvas descriptions into readable plain text.
 * Safe for React text nodes (no HTML rendering).
 */

function decodeBasicEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    });
}

function looksLikeHtml(input: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(input);
}

/** Strip tags and normalize Canvas/Google Calendar HTML into scan-friendly plain text. */
export function htmlToReadableText(input: string | undefined | null): string {
  if (!input) return '';
  const raw = String(input);
  if (!looksLikeHtml(raw)) {
    return decodeBasicEntities(raw).replace(/\r\n/g, '\n').trim();
  }

  let s = raw;
  // Prefer link labels; append URL when useful.
  s = s.replace(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, inner: string) => {
      const label = decodeBasicEntities(inner.replace(/<[^>]+>/g, '')).trim();
      if (!label) return href;
      if (label === href || label.includes(href)) return label;
      return `${label} (${href})`;
    }
  );

  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '\n• ');
  s = s.replace(/<\/li>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(h[1-6]|p|div|section|article|tr|blockquote)>/gi, '\n');
  s = s.replace(/<(h[1-6]|p|div|section|article|tr|blockquote)[^>]*>/gi, '\n');
  s = s.replace(/<hr[^>]*>/gi, '\n---\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeBasicEntities(s);

  return s
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True when the string appears to contain markup that should be cleaned for display. */
export function descriptionNeedsCleanup(input: string | undefined | null): boolean {
  if (!input) return false;
  return looksLikeHtml(input);
}
